import { fractionToPpm, PPM, type TestVerdict } from '@noi/shared';
import type { Meta } from './isolate.js';

export type RunStatus = 'OK' | 'TLE' | 'WALL' | 'MLE' | 'RE' | 'SIG' | 'SE';

export interface RunResult {
  status: RunStatus;
  exitCode: number | null;
  exitSig: number | null;
  timeMs: number;
  wallMs: number;
  memoryKb: number;
  message: string;
}

export const SIGPIPE = 13;

/** Interprets an isolate meta file. `memoryLimitKb` enables MLE detection heuristics. */
export function classifyRun(meta: Meta, memoryLimitKb: number): RunResult {
  const num = (k: string) => (meta[k] !== undefined ? Number(meta[k]) : null);
  const timeMs = Math.round((num('time') ?? 0) * 1000);
  const wallMs = Math.round((num('time-wall') ?? 0) * 1000);
  const memoryKb = num('cg-mem') ?? num('max-rss') ?? 0;
  const exitCode = num('exitcode');
  const exitSig = num('exitsig');
  const message = meta.message ?? '';
  const base = { exitCode, exitSig, timeMs, wallMs, memoryKb, message };
  const st = meta.status;

  if (st === 'XX') return { ...base, status: 'SE' };
  if (meta['cg-oom-killed'] === '1') return { ...base, status: 'MLE' };
  if (st === 'TO') return { ...base, status: /wall/i.test(message) ? 'WALL' : 'TLE' };
  if (st === 'SG' || st === 'RE') {
    // Without an OOM marker (e.g. bad_alloc abort, or rlimit mode) treat peak usage at the limit as MLE.
    if (memoryLimitKb > 0 && memoryKb >= memoryLimitKb * 0.98) return { ...base, status: 'MLE' };
    return { ...base, status: st === 'SG' ? 'SIG' : 'RE' };
  }
  if (st && st !== '') return { ...base, status: 'SE', message: `Unknown isolate status ${st}: ${message}` };
  return { ...base, status: 'OK' };
}

export interface Evaluation {
  verdict: TestVerdict;
  fractionPpm: number;
  message: string | null;
}

/** Verdict for a contestant run that did not finish normally (null if it did). */
export function runFailure(run: RunResult): Evaluation | null {
  switch (run.status) {
    case 'OK':
      return null;
    case 'TLE':
      return { verdict: 'TLE', fractionPpm: 0, message: 'Time limit exceeded' };
    case 'WALL':
      return { verdict: 'TLE', fractionPpm: 0, message: 'Wall time limit exceeded' };
    case 'MLE':
      return { verdict: 'MLE', fractionPpm: 0, message: 'Memory limit exceeded' };
    case 'RE':
      return { verdict: 'RE', fractionPpm: 0, message: `Exited with code ${run.exitCode}` };
    case 'SIG':
      return { verdict: 'RE', fractionPpm: 0, message: `Killed by signal ${run.exitSig}` };
    case 'SE':
      return { verdict: 'SE', fractionPpm: 0, message: `Sandbox error: ${run.message}` };
  }
}

/** testlib exit codes. */
export const TESTLIB = { OK: 0, WA: 1, PE: 2, FAIL: 3, DIRT: 4, POINTS: 7 } as const;

export function parsePoints(stderr: string): number | null {
  const m = /^\s*points\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/m.exec(stderr);
  return m ? Number(m[1]) : null;
}

/** Maps a testlib-style checker/interactor exit to a verdict. Returns null for an abnormal exit. */
export function testlibVerdict(exitCode: number | null, stderr: string): Evaluation | null {
  const message = stderr.trim().slice(0, 2000) || null;
  switch (exitCode) {
    case TESTLIB.OK:
      return { verdict: 'AC', fractionPpm: PPM, message };
    case TESTLIB.WA:
    case TESTLIB.PE:
    case TESTLIB.DIRT:
      return { verdict: 'WA', fractionPpm: 0, message };
    case TESTLIB.POINTS: {
      const p = parsePoints(stderr);
      if (p === null) return { verdict: 'SE', fractionPpm: 0, message: `Exit code 7 without points: ${message}` };
      const ppm = fractionToPpm(p);
      return { verdict: ppm === PPM ? 'AC' : ppm === 0 ? 'WA' : 'PA', fractionPpm: ppm, message };
    }
    default:
      return null;
  }
}

/** Result of running a custom checker in its own box. */
export function checkerVerdict(run: RunResult, stderr: string): Evaluation {
  if (run.status === 'OK' || run.status === 'RE') {
    const v = testlibVerdict(run.exitCode ?? 0, stderr);
    if (v) return v;
    return { verdict: 'SE', fractionPpm: 0, message: `Checker failed (exit ${run.exitCode}): ${stderr.trim().slice(0, 2000)}` };
  }
  return { verdict: 'SE', fractionPpm: 0, message: `Checker ${run.status}: ${run.message}` };
}

/**
 * Combines the contestant and interactor runs of an interactive test. First matching rule wins:
 *  1. interactor sandbox error                     -> SE
 *  2. contestant exceeded CPU time / memory        -> TLE / MLE
 *  3. interactor reported WA/PE                    -> WA   (a contestant crash may be a consequence)
 *  4. contestant crashed (except SIGPIPE)          -> RE
 *  5. contestant hit the wall-clock limit          -> TLE  (idleness, e.g. missing flush)
 *  6. interactor abnormal exit: SIGPIPE -> WA (solution quit early), otherwise SE
 *  7. interactor OK / points                       -> AC / PA
 */
/**
 * Contestant faults take precedence over the interactor's verdict (as in CMS): when the solution dies,
 * the interactor typically sees EOF and reports WA, which would hide the real cause. SIGPIPE is the
 * exception: it means the interactor had already finished, so its verdict stands.
 */
export function interactiveVerdict(contestant: RunResult, interactor: RunResult, interactorStderr: string): Evaluation {
  if (interactor.status === 'SE') return { verdict: 'SE', fractionPpm: 0, message: `Interactor sandbox error: ${interactor.message}` };
  if (contestant.status === 'TLE' || contestant.status === 'MLE') return runFailure(contestant)!;
  if (contestant.status === 'WALL') return { verdict: 'TLE', fractionPpm: 0, message: 'Idleness limit exceeded (did you flush stdout?)' };
  const contestantCrashed =
    contestant.status === 'RE' || (contestant.status === 'SIG' && contestant.exitSig !== SIGPIPE) || contestant.status === 'SE';
  if (contestantCrashed) return runFailure(contestant)!;

  const iv = interactor.status === 'OK' || interactor.status === 'RE' ? testlibVerdict(interactor.exitCode ?? 0, interactorStderr) : null;
  if (iv) return iv;
  if (interactor.status === 'SIG' && interactor.exitSig === SIGPIPE) {
    return { verdict: 'WA', fractionPpm: 0, message: 'Solution terminated before the interaction finished' };
  }
  return {
    verdict: 'SE',
    fractionPpm: 0,
    message: `Interactor failed (${interactor.status}, exit ${interactor.exitCode}, signal ${interactor.exitSig}): ${interactorStderr.trim().slice(0, 2000)}`,
  };
}
