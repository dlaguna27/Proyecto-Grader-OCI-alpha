import { precisionStep } from '../score.js';
import { PPM, type IoiTaskScoreRule, type SubtaskScoring } from '../types.js';

export interface SubtaskDef {
  id: string;
  pointsCenti: number;
  scoring: SubtaskScoring;
  testIds: string[];
}

/**
 * Score of one subtask in centi-points, floored to the problem precision.
 * Missing test results count as 0 (e.g. skipped or not yet run).
 */
export function subtaskScore(
  subtask: SubtaskDef,
  fractions: ReadonlyMap<string, number>,
  precision: number,
): number {
  const step = BigInt(precisionStep(precision));
  const n = subtask.testIds.length;
  if (n === 0 || subtask.pointsCenti <= 0) return 0;
  const f = subtask.testIds.map((id) => BigInt(clampPpm(fractions.get(id) ?? 0)));
  const points = BigInt(subtask.pointsCenti);
  let raw: bigint;
  if (subtask.scoring === 'MIN') {
    const min = f.reduce((a, b) => (b < a ? b : a));
    raw = (points * min) / BigInt(PPM);
  } else {
    const sum = f.reduce((a, b) => a + b, 0n);
    raw = (points * sum) / (BigInt(n) * BigInt(PPM));
  }
  return Number((raw / step) * step);
}

export interface SubmissionScore {
  totalCenti: number;
  subtasks: { id: string; scoreCenti: number }[];
}

export function scoreSubmission(
  subtasks: readonly SubtaskDef[],
  fractions: ReadonlyMap<string, number>,
  precision: number,
): SubmissionScore {
  const scored = subtasks.map((s) => ({ id: s.id, scoreCenti: subtaskScore(s, fractions, precision) }));
  return { totalCenti: scored.reduce((a, s) => a + s.scoreCenti, 0), subtasks: scored };
}

/**
 * A contestant's score on one task given all of their scored submissions.
 * MAX_SUBTASK: sum over subtasks of the best result in any submission (IOI 2017+).
 * BEST_SUBMISSION: best single submission total.
 */
export function ioiTaskScore(
  rule: IoiTaskScoreRule,
  submissions: readonly SubmissionScore[],
): { totalCenti: number; subtaskBest: Record<string, number> } {
  const subtaskBest: Record<string, number> = {};
  for (const sub of submissions) {
    for (const st of sub.subtasks) {
      subtaskBest[st.id] = Math.max(subtaskBest[st.id] ?? 0, st.scoreCenti);
    }
  }
  if (rule === 'MAX_SUBTASK') {
    return { totalCenti: Object.values(subtaskBest).reduce((a, b) => a + b, 0), subtaskBest };
  }
  return { totalCenti: submissions.reduce((a, s) => Math.max(a, s.totalCenti), 0), subtaskBest };
}

/**
 * Same as `ioiTaskScore`, plus when the task score last increased: the `atMs` of the submission
 * that brought it to its final value (null while the score is 0). `subs` must be in time order.
 */
export function ioiTaskScoreReached(
  rule: IoiTaskScoreRule,
  subs: readonly { atMs: number; score: SubmissionScore }[],
): { totalCenti: number; reachedAtMs: number | null } {
  const subtaskBest: Record<string, number> = {};
  let bestSubmission = 0;
  let totalCenti = 0;
  let reachedAtMs: number | null = null;
  for (const s of subs) {
    for (const st of s.score.subtasks) subtaskBest[st.id] = Math.max(subtaskBest[st.id] ?? 0, st.scoreCenti);
    bestSubmission = Math.max(bestSubmission, s.score.totalCenti);
    const t = rule === 'MAX_SUBTASK' ? Object.values(subtaskBest).reduce((a, b) => a + b, 0) : bestSubmission;
    if (t > totalCenti) {
      totalCenti = t;
      reachedAtMs = s.atMs;
    }
  }
  return { totalCenti, reachedAtMs };
}

/** TIME: equal totals are ordered by who reached them first (no shared ranks); SHARED: equal totals share a rank. */
export type IoiTieBreak = 'TIME' | 'SHARED';

export function compareIoiTotals(
  a: { totalCenti: number; reachedAtMs: number | null },
  b: { totalCenti: number; reachedAtMs: number | null },
  tieBreak: IoiTieBreak,
): number {
  return b.totalCenti - a.totalCenti || (tieBreak === 'TIME' ? (a.reachedAtMs ?? 0) - (b.reachedAtMs ?? 0) : 0);
}

function clampPpm(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(PPM, Math.floor(v));
}
