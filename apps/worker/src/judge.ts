import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { JudgeJob, JudgeProgress, JudgeResult, Language, TestOutcome } from '@noi/shared';
import { compareOutputs } from './compare.js';
import { config } from './config.js';
import type { FileSource } from './files.js';
import { Box, exec, type RunSpec } from './isolate.js';
import { checkerVerdict, classifyRun, interactiveVerdict, runFailure, type Evaluation, type RunResult } from './verdict.js';

const MB = 1024;
const COMPILE_LIMITS = { timeSec: 10, wallSec: 20, memoryKb: 1024 * MB, processes: 32, fsizeKb: 64 * MB };
const RUN_FSIZE_KB = 64 * MB;
const COMPILE_LOG_MAX = 64 * 1024;
/** Bump when compiler flags change so cached checker binaries are rebuilt. */
const TOOL_CACHE_VERSION = 'v1';

export const CPP_FLAGS = ['-O3', '-std=gnu++20', '-pipe', '-static', '-DONLINE_JUDGE'];

interface Slot {
  index: number;
  compileBox: Box;
  runBox: Box;
  checkBox: Box;
  interactorBox: Box;
  workDir: string;
}

export function makeSlot(index: number): Slot {
  const base = index * 10;
  return {
    index,
    compileBox: new Box(base),
    runBox: new Box(base + 1),
    checkBox: new Box(base + 2),
    interactorBox: new Box(base + 3),
    workDir: path.join(config.cacheDir, 'work', String(index)),
  };
}

type Executable = { kind: 'binary'; path: string } | { kind: 'python'; path: string };

class CompileError extends Error {
  constructor(readonly log: string) {
    super('Compilation failed');
  }
}

class SystemError extends Error {}

async function readCapped(p: string, max: number): Promise<string> {
  try {
    const h = await fs.open(p, 'r');
    try {
      const buf = Buffer.alloc(max);
      const { bytesRead } = await h.read(buf, 0, max, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await h.close();
    }
  } catch {
    return '';
  }
}

async function compileInBox(
  box: Box,
  workDir: string,
  sourcePath: string,
  language: Language,
  extraFlags: string[] = [],
): Promise<{ ok: boolean; log: string; output: string | null }> {
  await box.init();
  try {
    const srcName = language === 'cpp' ? 'sol.cpp' : 'sol.py';
    await box.put(sourcePath, srcName);
    const argv =
      language === 'cpp'
        ? ['/usr/bin/g++', ...CPP_FLAGS, ...extraFlags, '-o', 'sol', srcName, '-lm']
        : ['/usr/bin/python3', '-m', 'py_compile', srcName];
    const logPath = path.join(workDir, 'compile.log');
    const raw = await box.run(
      { ...COMPILE_LIMITS, argv, stdout: logPath + '.out', stderr: logPath },
      path.join(workDir, 'compile.meta'),
    );
    const run = classifyRun(raw.meta, 0);
    let log = (await readCapped(logPath, COMPILE_LOG_MAX)) + (await readCapped(logPath + '.out', COMPILE_LOG_MAX));
    if (run.status === 'SE') throw new SystemError(`Compilation sandbox error: ${run.message}`);
    if (run.status === 'TLE' || run.status === 'WALL') log += '\nCompilation time limit exceeded';
    if (run.status === 'MLE') log += '\nCompilation memory limit exceeded';
    if (run.status !== 'OK') return { ok: false, log: log.trim(), output: null };
    const out = path.join(workDir, `compiled-${randomUUID()}`);
    await fs.copyFile(path.join(box.dir, language === 'cpp' ? 'sol' : srcName), out);
    return { ok: true, log: log.trim(), output: out };
  } finally {
    await box.cleanup();
  }
}

const toolInflight = new Map<string, Promise<string>>();

/** Compiles a testlib checker/interactor once and caches the binary by source hash. */
async function compileTool(slot: Slot, files: FileSource, sha: string, what: string): Promise<string> {
  const key = createHash('sha256').update(`${TOOL_CACHE_VERSION}:${sha}`).digest('hex');
  const dest = path.join(config.cacheDir, 'tools', key);
  try {
    await fs.access(dest);
    return dest;
  } catch {
    /* compile */
  }
  let p = toolInflight.get(key);
  if (!p) {
    p = (async () => {
      const src = await files.get(sha);
      // testlib.h is copied into the box next to the source.
      const box = slot.compileBox;
      await box.init();
      try {
        await box.put(src, 'tool.cpp');
        await box.put(path.join(config.testlibDir, 'testlib.h'), 'testlib.h');
        const logPath = path.join(slot.workDir, `${what}.log`);
        const raw = await box.run(
          {
            ...COMPILE_LIMITS,
            timeSec: 60,
            wallSec: 90,
            argv: ['/usr/bin/g++', '-O2', '-std=gnu++20', '-pipe', '-static', '-o', 'tool', 'tool.cpp', '-lm'],
            stderr: logPath,
          },
          path.join(slot.workDir, `${what}.meta`),
        );
        const run = classifyRun(raw.meta, 0);
        if (run.status !== 'OK') {
          throw new SystemError(`${what} failed to compile (${run.status}): ${(await readCapped(logPath, 4000)).trim()}`);
        }
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const tmp = `${dest}.${randomUUID()}.tmp`;
        await fs.copyFile(path.join(box.dir, 'tool'), tmp);
        await fs.chmod(tmp, 0o755);
        await fs.rename(tmp, dest);
        return dest;
      } finally {
        await box.cleanup();
      }
    })().finally(() => toolInflight.delete(key));
    toolInflight.set(key, p);
  }
  return p;
}

function solutionArgv(exe: Executable): string[] {
  return exe.kind === 'binary' ? ['./sol'] : ['/usr/bin/python3', 'sol.py'];
}

async function putSolution(box: Box, exe: Executable): Promise<void> {
  if (exe.kind === 'binary') await box.put(exe.path, 'sol', 0o755);
  else await box.put(exe.path, 'sol.py');
}

function contestantLimits(job: JudgeJob): Omit<RunSpec, 'argv'> {
  const timeSec = job.timeLimitMs / 1000;
  return {
    timeSec,
    wallSec: Math.ceil(timeSec * 2 + 1),
    memoryKb: job.memoryLimitMb * MB,
    processes: 1,
    fsizeKb: RUN_FSIZE_KB,
  };
}

interface Ctx {
  job: JudgeJob;
  slot: Slot;
  files: FileSource;
  exe: Executable | null;
  checkerBin: string | null;
  interactorBin: string | null;
}

async function evaluateOutput(ctx: Ctx, inputPath: string, outputPath: string, answerSha: string | null): Promise<Evaluation> {
  const { job, slot, files } = ctx;
  if (!answerSha) throw new SystemError('Test has no expected output');
  const answerPath = await files.get(answerSha);
  if (job.checker.kind === 'TOKENS') return compareOutputs(outputPath, answerPath, null);
  if (job.checker.kind === 'FLOAT') return compareOutputs(outputPath, answerPath, job.checker.epsilon ?? 1e-6);

  const box = slot.checkBox;
  await box.init();
  try {
    await box.put(ctx.checkerBin!, 'checker', 0o755);
    await box.put(inputPath, 'input.txt');
    await box.put(outputPath, 'output.txt');
    await box.put(answerPath, 'answer.txt');
    const stderrPath = path.join(slot.workDir, 'checker.err');
    const raw = await box.run(
      {
        argv: ['./checker', 'input.txt', 'output.txt', 'answer.txt'],
        timeSec: 10,
        wallSec: 20,
        memoryKb: 1024 * MB,
        processes: 1,
        fsizeKb: RUN_FSIZE_KB,
        stdout: path.join(slot.workDir, 'checker.out'),
        stderr: stderrPath,
      },
      path.join(slot.workDir, 'checker.meta'),
    );
    return checkerVerdict(classifyRun(raw.meta, 0), await readCapped(stderrPath, 16 * 1024));
  } finally {
    await box.cleanup();
  }
}

function outcome(testId: string, ev: Evaluation, run: RunResult | null): TestOutcome {
  return {
    testId,
    verdict: ev.verdict,
    fractionPpm: ev.fractionPpm,
    timeMs: run ? run.timeMs : null,
    memoryKb: run ? run.memoryKb : null,
    message: ev.message,
  };
}

async function runBatch(ctx: Ctx, test: JudgeJob['tests'][number]): Promise<TestOutcome> {
  const { job, slot, files } = ctx;
  const inputPath = await files.get(test.inputSha);
  const outputPath = path.join(slot.workDir, 'output.txt');
  const box = slot.runBox;
  const limits = contestantLimits(job);
  await box.init();
  let run: RunResult;
  try {
    await putSolution(box, ctx.exe!);
    const raw = await box.run(
      { ...limits, argv: solutionArgv(ctx.exe!), stdin: inputPath, stdout: outputPath },
      path.join(slot.workDir, 'run.meta'),
    );
    run = classifyRun(raw.meta, limits.memoryKb);
  } finally {
    await box.cleanup();
  }
  const failure = runFailure(run);
  if (failure) return outcome(test.id, failure, run);
  return outcome(test.id, await evaluateOutput(ctx, inputPath, outputPath, test.answerSha), run);
}

async function runOutputOnly(ctx: Ctx, test: JudgeJob['tests'][number]): Promise<TestOutcome> {
  const sha = ctx.job.outputs?.[test.id];
  if (!sha) return outcome(test.id, { verdict: 'WA', fractionPpm: 0, message: 'No output file submitted' }, null);
  const inputPath = await ctx.files.get(test.inputSha);
  const outputPath = await ctx.files.get(sha);
  return outcome(test.id, await evaluateOutput(ctx, inputPath, outputPath, test.answerSha), null);
}

async function runInteractive(ctx: Ctx, test: JudgeJob['tests'][number]): Promise<TestOutcome> {
  const { job, slot, files } = ctx;
  const inputPath = await files.get(test.inputSha);
  const answerPath = test.answerSha ? await files.get(test.answerSha) : null;
  const limits = contestantLimits(job);
  const toUser = path.join(slot.workDir, 'fifo-to-user');
  const fromUser = path.join(slot.workDir, 'fifo-from-user');
  await Promise.all([fs.rm(toUser, { force: true }), fs.rm(fromUser, { force: true })]);
  const mk = await exec('/usr/bin/mkfifo', ['-m', '600', toUser, fromUser]);
  if (mk.code !== 0) throw new SystemError(`mkfifo failed: ${mk.stderr}`);

  const cBox = slot.runBox;
  const iBox = slot.interactorBox;
  await Promise.all([cBox.init(), iBox.init()]);
  try {
    await putSolution(cBox, ctx.exe!);
    await iBox.put(ctx.interactorBin!, 'interactor', 0o755);
    await iBox.put(inputPath, 'input.txt');
    if (answerPath) await iBox.put(answerPath, 'answer.txt');
    else await fs.writeFile(path.join(iBox.dir, 'answer.txt'), '');
    const iStderr = path.join(slot.workDir, 'interactor.err');
    // Contestant: stdin <- interactor, stdout -> interactor. The boxes share nothing but these two pipes.
    const [cRaw, iRaw] = await Promise.all([
      cBox.run(
        { ...limits, argv: solutionArgv(ctx.exe!), stdin: toUser, stdout: fromUser, shellRedirect: true },
        path.join(slot.workDir, 'run.meta'),
      ),
      iBox.run(
        {
          argv: ['./interactor', 'input.txt', 'tout.txt', 'answer.txt'],
          timeSec: limits.wallSec + 1,
          wallSec: limits.wallSec + 2,
          memoryKb: Math.max(512 * MB, limits.memoryKb),
          processes: 1,
          fsizeKb: RUN_FSIZE_KB,
          stdin: fromUser,
          stdout: toUser,
          stderr: iStderr,
          shellRedirect: true,
          stdoutFirst: true,
        },
        path.join(slot.workDir, 'interactor.meta'),
      ),
    ]);
    const cRun = classifyRun(cRaw.meta, limits.memoryKb);
    const iRun = classifyRun(iRaw.meta, 0);
    const ev = interactiveVerdict(cRun, iRun, await readCapped(iStderr, 16 * 1024));
    return outcome(test.id, ev, cRun);
  } finally {
    await Promise.all([cBox.cleanup(), iBox.cleanup()]);
  }
}

/** Grades one judgement. Throws only on infrastructure failures (missing files etc.). */
export async function judge(
  job: JudgeJob,
  slot: Slot,
  files: FileSource,
  onProgress: (p: JudgeProgress) => void | Promise<void> = () => {},
): Promise<JudgeResult> {
  const base = { judgementId: job.judgementId, token: job.token, worker: config.workerName };
  await fs.rm(slot.workDir, { recursive: true, force: true });
  await fs.mkdir(slot.workDir, { recursive: true });
  try {
    const ctx: Ctx = { job, slot, files, exe: null, checkerBin: null, interactorBin: null };
    let compileLog: string | null = null;

    // Prefetch every file the job needs so network hiccups surface before grading starts.
    const shas = new Set<string>();
    for (const t of job.tests) {
      shas.add(t.inputSha);
      if (t.answerSha) shas.add(t.answerSha);
    }
    for (const s of Object.values(job.outputs ?? {})) shas.add(s);
    if (job.sourceSha) shas.add(job.sourceSha);
    await Promise.all([...shas].map((s) => files.get(s)));

    if (job.problemType !== 'OUTPUT_ONLY') {
      if (!job.language || !job.sourceSha) throw new SystemError('Submission has no source');
      await onProgress({ stage: 'COMPILING', done: 0, total: job.tests.length });
      const c = await compileInBox(slot.compileBox, slot.workDir, await files.get(job.sourceSha), job.language);
      compileLog = c.log || null;
      if (!c.ok) throw new CompileError(c.log);
      ctx.exe = { kind: job.language === 'cpp' ? 'binary' : 'python', path: c.output! };
    }
    if (job.checker.kind === 'CUSTOM' && job.problemType !== 'INTERACTIVE') {
      if (!job.checker.sourceSha) throw new SystemError('Custom checker not uploaded');
      ctx.checkerBin = await compileTool(slot, files, job.checker.sourceSha, 'checker');
    }
    if (job.problemType === 'INTERACTIVE') {
      if (!job.interactorSha) throw new SystemError('Interactor not uploaded');
      ctx.interactorBin = await compileTool(slot, files, job.interactorSha, 'interactor');
    }

    // A MIN-scored subtask is "dead" once one of its tests scored 0; its remaining tests can be skipped
    // unless they also belong to a live subtask (or to no subtask at all).
    const membership = new Map<string, number[]>();
    job.subtasks?.forEach((st, i) => st.testIds.forEach((t) => membership.set(t, [...(membership.get(t) ?? []), i])));
    const dead = new Set<number>();

    const results: TestOutcome[] = [];
    let stop = false;
    for (const [i, test] of job.tests.entries()) {
      await onProgress({ stage: 'RUNNING', done: i, total: job.tests.length });
      const subs = membership.get(test.id);
      const skippable = job.subtasks && subs && subs.length > 0 && subs.every((s) => dead.has(s));
      if (stop || skippable) {
        results.push({ testId: test.id, verdict: 'SKIPPED', fractionPpm: 0, timeMs: null, memoryKb: null, message: null });
        continue;
      }
      const r =
        job.problemType === 'BATCH'
          ? await runBatch(ctx, test)
          : job.problemType === 'OUTPUT_ONLY'
            ? await runOutputOnly(ctx, test)
            : await runInteractive(ctx, test);
      results.push(r);
      if (r.verdict === 'SE') return { ...base, status: 'SE', compileLog, tests: results, error: r.message };
      if (r.fractionPpm === 0) {
        subs?.forEach((s) => job.subtasks![s].scoring === 'MIN' && dead.add(s));
      }
      if (job.stopOnFirstFailure && r.verdict !== 'AC') stop = true;
    }
    return { ...base, status: 'DONE', compileLog, tests: results, error: null };
  } catch (e) {
    if (e instanceof CompileError) return { ...base, status: 'CE', compileLog: e.log, tests: [], error: null };
    return { ...base, status: 'SE', compileLog: null, tests: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    await fs.rm(slot.workDir, { recursive: true, force: true }).catch(() => {});
  }
}
