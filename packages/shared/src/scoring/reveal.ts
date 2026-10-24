import { compareIcpcTotals } from './icpc.js';
import { compareIoiTotals, type IoiTieBreak } from './ioi.js';
import { assignRanks } from './rank.js';

export interface RevealIoiCell {
  scoreCenti: number;
  attempts: number;
  pending: number;
  /** When the task score reached its current value (for IOI time tie-breaks). */
  reachedAtMs?: number | null;
}

export interface RevealIcpcCell {
  solved: boolean;
  rejected: number;
  penaltyMinutes: number;
  solveMinute: number | null;
  /** Time of the first AC relative to the team's own start, for tie-breaking. */
  acElapsedMs: number | null;
  pending: boolean;
  pendingCount: number;
}

export interface RevealTeam<C> {
  userId: string;
  displayName: string;
  /** Cells shown when the reveal starts (e.g. the frozen scoreboard). */
  before: Record<string, C>;
  /** Final cells. */
  after: Record<string, C>;
}

/**
 * team: the team about to be worked on is marked; problem: its next hidden cell is marked;
 * reveal: that cell shows its final result and the ranking updates; final: the team is finalized.
 */
export type RevealPhase = 'team' | 'problem' | 'reveal' | 'final';

export interface RevealStep<C> {
  cells: Record<string, Record<string, C>>;
  order: { userId: string; rank: number }[];
  finalized: string[];
  /** Team (and problem, for the problem/reveal phases) touched by this step. */
  focus: { userId: string; problemId: string | null; phase: RevealPhase } | null;
}

/**
 * CURRENT_RANK: always work on the lowest team on the board as it stands (ICPC resolver).
 * FINAL_RANK: work through teams by final position, last place first.
 */
export type RevealOrder = 'CURRENT_RANK' | 'FINAL_RANK';

type Mode = 'IOI' | 'ICPC';

function sameCell(mode: Mode, a: unknown, b: unknown): boolean {
  if (mode === 'IOI') {
    const x = a as RevealIoiCell;
    const y = b as RevealIoiCell;
    return x.scoreCenti === y.scoreCenti && x.pending === y.pending;
  }
  const x = a as RevealIcpcCell;
  const y = b as RevealIcpcCell;
  return x.solved === y.solved && x.rejected === y.rejected && x.penaltyMinutes === y.penaltyMinutes && x.pending === y.pending;
}

/** Ranks teams by the given cells with the same rules as the scoreboard. */
export function rankRevealCells<C extends RevealIoiCell | RevealIcpcCell>(
  mode: Mode,
  teams: readonly { userId: string; displayName: string }[],
  cells: Record<string, Record<string, C>>,
  ioiTieBreak: IoiTieBreak = 'SHARED',
): { userId: string; rank: number }[] {
  const rows = teams.map((t) => {
    const cs = Object.values(cells[t.userId] ?? {});
    if (mode === 'IOI') {
      const ioi = cs as RevealIoiCell[];
      return { t, a: ioi.reduce((s, c) => s + c.scoreCenti, 0), b: 0, c: Math.max(0, ...ioi.map((c) => (c.scoreCenti > 0 ? (c.reachedAtMs ?? 0) : 0))) };
    }
    let solved = 0;
    let penalty = 0;
    let lastAc = 0;
    for (const c of cs as RevealIcpcCell[]) {
      if (!c.solved) continue;
      solved++;
      penalty += c.penaltyMinutes;
      lastAc = Math.max(lastAc, c.acElapsedMs ?? 0);
    }
    return { t, a: solved, b: penalty, c: lastAc };
  });
  type Row = (typeof rows)[number];
  const cmp =
    mode === 'IOI'
      ? (x: Row, y: Row) => compareIoiTotals({ totalCenti: x.a, reachedAtMs: x.c }, { totalCenti: y.a, reachedAtMs: y.c }, ioiTieBreak)
      : (x: Row, y: Row) => compareIcpcTotals({ solved: x.a, penalty: x.b, lastAcAtMs: x.c }, { solved: y.a, penalty: y.b, lastAcAtMs: y.c });
  return assignRanks(rows, cmp, (x, y) => x.t.displayName.localeCompare(y.t.displayName), mode === 'IOI' && ioiTieBreak === 'TIME').map(({ row, rank }) => ({ userId: row.t.userId, rank }));
}

/**
 * Precomputes every step of a closing-ceremony reveal, one per key press: mark the team, mark its
 * next hidden problem, reveal that problem (the ranking updates), repeat; a team with nothing left
 * hidden is finalized. The last step's cells equal the `after` cells of every team.
 */
export function buildRevealSteps<C extends RevealIoiCell | RevealIcpcCell>(
  mode: Mode,
  problemIds: readonly string[],
  teams: readonly RevealTeam<C>[],
  orderRule: RevealOrder,
  ioiTieBreak: IoiTieBreak = 'SHARED',
): RevealStep<C>[] {
  let cells: Record<string, Record<string, C>> = {};
  for (const t of teams) cells[t.userId] = { ...t.before };
  const byId = new Map(teams.map((t) => [t.userId, t]));
  const finalOrder = rankRevealCells(mode, teams, Object.fromEntries(teams.map((t) => [t.userId, t.after])), ioiTieBreak);
  const finalized: string[] = [];
  const done = new Set<string>();
  let marked: string | null = null;
  let order = rankRevealCells(mode, teams, cells, ioiTieBreak);
  const steps: RevealStep<C>[] = [{ cells, order, finalized: [], focus: null }];
  for (;;) {
    const candidates = orderRule === 'CURRENT_RANK' ? order : finalOrder;
    const target = [...candidates].reverse().find((r) => !done.has(r.userId));
    if (!target) break;
    const team = byId.get(target.userId)!;
    const pid = problemIds.find((p) => team.after[p] && !sameCell(mode, cells[team.userId][p], team.after[p]));
    const push = (problemId: string | null, phase: RevealPhase) =>
      steps.push({ cells, order, finalized: [...finalized], focus: { userId: team.userId, problemId, phase } });
    if (pid) {
      if (marked !== team.userId) push(null, 'team');
      marked = team.userId;
      push(pid, 'problem');
      cells = { ...cells, [team.userId]: { ...cells[team.userId], [pid]: team.after[pid] } };
      order = rankRevealCells(mode, teams, cells, ioiTieBreak);
      push(pid, 'reveal');
    } else {
      done.add(team.userId);
      finalized.push(team.userId);
      marked = null;
      push(null, 'final');
    }
  }
  return steps;
}
