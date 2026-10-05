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

function clampPpm(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(PPM, Math.floor(v));
}
