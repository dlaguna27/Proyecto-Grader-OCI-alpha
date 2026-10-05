import os from 'node:os';

function int(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

export const config = {
  redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
  apiInternalUrl: (process.env.API_INTERNAL_URL ?? 'http://api:3000').replace(/\/$/, ''),
  workerToken: process.env.WORKER_TOKEN ?? '',
  workerName: process.env.WORKER_NAME || os.hostname(),
  /** Parallel grading slots in this container; each should have a dedicated CPU core. */
  slots: Math.max(1, int('JUDGE_SLOTS', 1)),
  /** Optional comma-separated CPU list, one per slot, for pinning (e.g. "2,3"). */
  cpus: (process.env.JUDGE_CPUS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  useCgroups: process.env.ISOLATE_CGROUPS !== '0',
  cacheDir: process.env.JUDGE_CACHE_DIR ?? '/var/cache/judge',
  isolateBin: process.env.ISOLATE_BIN ?? '/usr/local/bin/isolate',
  isolateConfig: process.env.ISOLATE_CONFIG ?? '/usr/local/etc/isolate',
  testlibDir: process.env.TESTLIB_DIR ?? '/opt/testlib',
};
