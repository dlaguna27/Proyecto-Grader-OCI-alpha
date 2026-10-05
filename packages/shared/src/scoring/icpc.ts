export type IcpcOutcome = 'AC' | 'REJECTED' | 'CE' | 'SE' | 'PENDING';

export interface IcpcSubmission {
  id: string;
  submittedAtMs: number;
  outcome: IcpcOutcome;
}

export interface IcpcProblemState {
  solved: boolean;
  /** Rejected submissions counted for penalty (before the first AC, or all if unsolved). */
  rejected: number;
  /** Penalty minutes for this problem; 0 if unsolved. */
  penaltyMinutes: number;
  /** Minutes from the contestant's start to the first AC. */
  solveMinute: number | null;
  firstAcAtMs: number | null;
  /** True if some submission that could change this cell is still pending. */
  pending: boolean;
  /** Submissions pending (shown as "?" on frozen/live boards). */
  pendingCount: number;
}

export interface IcpcOptions {
  /** Contestant's effective start time (contest start + personal offset). */
  startMs: number;
  penaltyPerReject: number;
  /** Count compilation errors as rejected attempts (ICPC default: false). */
  countCompileErrors?: boolean;
}

export function compareSubmissionOrder(a: IcpcSubmission, b: IcpcSubmission): number {
  return a.submittedAtMs - b.submittedAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Derives a scoreboard cell from the full list of one contestant's submissions on one
 * problem. The result depends only on submission order, never on judging order.
 */
export function icpcProblemState(subs: readonly IcpcSubmission[], opts: IcpcOptions): IcpcProblemState {
  const ordered = [...subs].sort(compareSubmissionOrder);
  let rejected = 0;
  let pendingCount = 0;
  for (const s of ordered) {
    if (s.outcome === 'PENDING') {
      pendingCount++;
      continue;
    }
    if (s.outcome === 'AC') {
      if (pendingCount > 0) {
        // An earlier pending submission may still turn out to be the first AC or add penalty.
        return { solved: false, rejected, penaltyMinutes: 0, solveMinute: null, firstAcAtMs: null, pending: true, pendingCount: pendingCount + 1 };
      }
      const solveMinute = Math.max(0, Math.floor((s.submittedAtMs - opts.startMs) / 60_000));
      return {
        solved: true,
        rejected,
        penaltyMinutes: solveMinute + opts.penaltyPerReject * rejected,
        solveMinute,
        firstAcAtMs: s.submittedAtMs,
        pending: false,
        pendingCount: 0,
      };
    }
    if (s.outcome === 'REJECTED' || (s.outcome === 'CE' && opts.countCompileErrors)) rejected++;
  }
  return { solved: false, rejected, penaltyMinutes: 0, solveMinute: null, firstAcAtMs: null, pending: pendingCount > 0, pendingCount };
}

export interface IcpcTotals {
  solved: number;
  penalty: number;
  lastAcAtMs: number;
}

export function icpcTotals(cells: readonly IcpcProblemState[]): IcpcTotals {
  let solved = 0;
  let penalty = 0;
  let lastAcAtMs = 0;
  for (const c of cells) {
    if (!c.solved) continue;
    solved++;
    penalty += c.penaltyMinutes;
    lastAcAtMs = Math.max(lastAcAtMs, c.firstAcAtMs ?? 0);
  }
  return { solved, penalty, lastAcAtMs };
}

/** Sort key comparator: more solved, then less penalty, then earlier last AC. */
export function compareIcpcTotals(a: IcpcTotals, b: IcpcTotals): number {
  return b.solved - a.solved || a.penalty - b.penalty || a.lastAcAtMs - b.lastAcAtMs;
}
