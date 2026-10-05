import { spawn } from 'node:child_process';
import { promises as fs, constants as fsc } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export type Meta = Record<string, string>;

export interface RunSpec {
  argv: string[];
  timeSec: number;
  wallSec: number;
  memoryKb: number;
  processes: number;
  fsizeKb: number;
  env?: Record<string, string>;
  /** Host paths (outside the box) used as stdio. Default: /dev/null. */
  stdin?: string;
  stdout?: string;
  stderr?: string;
  /** Open stdin/stdout via a shell redirect (needed for FIFOs, whose open() blocks). */
  shellRedirect?: boolean;
  /** With shellRedirect: open stdout before stdin. The two peers of a FIFO pair must open in opposite orders. */
  stdoutFirst?: boolean;
}

export interface RawRun {
  meta: Meta;
  isolateExit: number | null;
}

const BOX_ROOT = '/var/local/lib/isolate';

/** One isolate sandbox. A fresh box is created for every run so cgroup stats never leak between runs. */
export class Box {
  constructor(readonly id: number) {}

  get dir(): string {
    return path.join(BOX_ROOT, String(this.id), 'box');
  }

  private baseArgs(): string[] {
    return [...(config.useCgroups ? ['--cg'] : []), `--box-id=${this.id}`];
  }

  async init(): Promise<void> {
    await this.cleanup();
    const r = await exec(config.isolateBin, [...this.baseArgs(), '--init']);
    if (r.code !== 0) throw new Error(`isolate --init failed for box ${this.id}: ${r.stderr.trim()}`);
  }

  async cleanup(): Promise<void> {
    await exec(config.isolateBin, [...this.baseArgs(), '--cleanup']);
  }

  async put(hostPath: string, name: string, mode = 0o644): Promise<void> {
    const dest = path.join(this.dir, name);
    await fs.copyFile(hostPath, dest);
    await fs.chmod(dest, mode);
  }

  async run(spec: RunSpec, metaPath: string): Promise<RawRun> {
    await fs.rm(metaPath, { force: true });
    const args = [
      ...this.baseArgs(),
      '--silent',
      `--meta=${metaPath}`,
      `--time=${spec.timeSec}`,
      `--wall-time=${spec.wallSec}`,
      `--extra-time=0`,
      config.useCgroups ? `--cg-mem=${spec.memoryKb}` : `--mem=${spec.memoryKb}`,
      `--processes=${spec.processes}`,
      `--fsize=${spec.fsizeKb}`,
      '--env=PATH=/usr/local/bin:/usr/bin:/bin',
      '--env=HOME=/box',
      ...Object.entries(spec.env ?? {}).map(([k, v]) => `--env=${k}=${v}`),
      '--run',
      '--',
      ...spec.argv,
    ];
    const supervisorMs = (spec.wallSec + 5) * 1000;
    let code: number | null;
    if (spec.shellRedirect) {
      // The shell blocks in open() on the FIFOs until the peer opens them, then execs isolate.
      code = await spawnWait(
        '/bin/sh',
        [
          '-c',
          spec.stdoutFirst
            ? 'exec "$0" "$@" >"$NOI_STDOUT" <"$NOI_STDIN"'
            : 'exec "$0" "$@" <"$NOI_STDIN" >"$NOI_STDOUT"',
          config.isolateBin,
          ...args,
        ],
        { NOI_STDIN: spec.stdin ?? '/dev/null', NOI_STDOUT: spec.stdout ?? '/dev/null' },
        ['ignore', 'ignore', spec.stderr ?? '/dev/null'],
        supervisorMs,
      );
    } else {
      code = await spawnWait(
        config.isolateBin,
        args,
        {},
        [spec.stdin ?? '/dev/null', spec.stdout ?? '/dev/null', spec.stderr ?? '/dev/null'],
        supervisorMs,
      );
    }
    let meta: Meta = {};
    try {
      meta = parseMeta(await fs.readFile(metaPath, 'utf8'));
    } catch {
      meta = { status: 'XX', message: `isolate produced no meta file (exit ${code})` };
    }
    // isolate exit codes: 0 ok, 1 program failed, 2 isolate internal error.
    if (code === 2 && !meta.status) meta.status = 'XX';
    if (code === null) meta = { ...meta, status: 'XX', message: 'Supervisor timeout' };
    return { meta, isolateExit: code };
  }
}

export function parseMeta(text: string): Meta {
  const meta: Meta = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return meta;
}

type Stdio = 'ignore' | string;

async function spawnWait(
  cmd: string,
  args: string[],
  env: Record<string, string>,
  stdio: [Stdio, Stdio, Stdio],
  timeoutMs: number,
): Promise<number | null> {
  const fds: number[] = [];
  const handles: Awaited<ReturnType<typeof fs.open>>[] = [];
  try {
    const open = async (p: Stdio, write: boolean) => {
      if (p === 'ignore') return 'ignore' as const;
      const h = await fs.open(p, write ? fsc.O_WRONLY | fsc.O_CREAT | fsc.O_TRUNC : fsc.O_RDONLY);
      handles.push(h);
      fds.push(h.fd);
      return h.fd;
    };
    const s0 = await open(stdio[0], false);
    const s1 = await open(stdio[1], true);
    const s2 = await open(stdio[2], true);
    return await new Promise<number | null>((resolve) => {
      const child = spawn(cmd, args, {
        stdio: [s0, s1, s2],
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', ...env },
      });
      // Parent copies of the descriptors are closed as soon as the child has them.
      child.on('spawn', () => void Promise.all(handles.splice(0).map((h) => h.close().catch(() => {}))));
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, timeoutMs);
      child.on('error', () => {
        clearTimeout(timer);
        resolve(2);
      });
      child.on('exit', (c) => {
        clearTimeout(timer);
        resolve(c ?? 2);
      });
    });
  } finally {
    await Promise.all(handles.map((h) => h.close().catch(() => {})));
  }
}

export function exec(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => resolve({ code: 127, stdout, stderr: String(e) }));
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
