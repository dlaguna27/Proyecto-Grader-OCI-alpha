import {
  assignRanks,
  compareIcpcTotals,
  icpcProblemState,
  icpcTotals,
  ioiTaskScore,
  type IcpcOutcome,
  type IcpcSubmission,
  type IcpcProblemState,
  type SubmissionScore,
} from '@noi/shared';
import { participantWindow } from './contest.js';
import { prisma } from './db.js';

export interface BoardProblem {
  id: string;
  code: string;
  title: string;
  scorePrecision: number;
  maxScoreCenti: number | null;
}

export interface IoiCell {
  scoreCenti: number;
  attempts: number;
  pending: number;
}

export interface BoardRow {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  members: string;
  organization: string;
  region: string;
  /** IOI */
  totalCenti?: number;
  ioi?: Record<string, IoiCell>;
  /** ICPC */
  solved?: number;
  penalty?: number;
  icpc?: Record<string, IcpcCell>;
}

export type IcpcCell = IcpcProblemState & { firstSolve: boolean; acElapsedMs: number | null };

export interface Board {
  contestId: string;
  mode: 'IOI' | 'ICPC';
  frozen: boolean;
  freezeAt: string | null;
  generatedAt: string;
  problems: BoardProblem[];
  rows: BoardRow[];
}

const cache = new Map<string, { at: number; board: Board }>();
const TTL_MS = 3000;

const historyCache = new Map<string, { at: number; history: RankHistory }>();
const HISTORY_TTL_MS = 10_000;

export function invalidateScoreboard(contestId: string): void {
  for (const k of ['full', 'public']) {
    cache.delete(`${contestId}:${k}`);
    historyCache.delete(`${contestId}:${k}`);
  }
}

/**
 * Builds the scoreboard from the active judgement of every submission. `full` boards (admins)
 * ignore the freeze; public boards hide results of submissions made after the freeze time.
 */
export async function getScoreboard(contestId: string, full: boolean): Promise<Board> {
  const key = `${contestId}:${full ? 'full' : 'public'}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.board;
  const board = await computeScoreboard(contestId, full ? { includeHidden: true, frozen: false } : { includeHidden: false, frozen: 'auto' });
  cache.set(key, { at: Date.now(), board });
  return board;
}

/**
 * Boards for the closing-ceremony reveal: the frozen public board (or the same as `after` if the
 * contest has no freeze) and the final board, both without hidden participants.
 */
export async function getRevealBoards(contestId: string): Promise<{ before: Board; after: Board }> {
  const [before, after] = await Promise.all([
    computeScoreboard(contestId, { includeHidden: false, frozen: true }),
    computeScoreboard(contestId, { includeHidden: false, frozen: false }),
  ]);
  return { before, after };
}

async function loadContestData(contestId: string, includeHidden: boolean) {
  const contest = await prisma.contest.findUniqueOrThrow({ where: { id: contestId } });
  const problems = await prisma.problem.findMany({
    where: { contestId },
    orderBy: [{ ordinal: 'asc' }, { code: 'asc' }],
    include: { activeTestSet: { include: { subtasks: { select: { pointsCenti: true } } } } },
  });
  const participants = await prisma.contestParticipant.findMany({
    where: { contestId, ...(includeHidden ? {} : { hidden: false }), user: { role: 'CONTESTANT' } },
    include: { user: true },
  });
  const subs = await prisma.submission.findMany({
    where: { contestId },
    select: {
      id: true,
      userId: true,
      problemId: true,
      submittedAt: true,
      judgements: { where: { active: true }, select: { status: true, verdict: true, scoreCenti: true, subtaskScores: true } },
    },
    orderBy: { submittedAt: 'asc' },
  });
  return { contest, problems, participants, subs };
}

/** `frozen: 'auto'` freezes once the freeze time has passed; `true` applies the freeze regardless of the clock. */
async function computeScoreboard(contestId: string, opts: { includeHidden: boolean; frozen: boolean | 'auto' }): Promise<Board> {
  const { contest, problems, participants, subs } = await loadContestData(contestId, opts.includeHidden);
  const now = Date.now();
  const frozen = contest.freezeAt !== null && (opts.frozen === 'auto' ? now >= contest.freezeAt.getTime() : opts.frozen);
  const freezeOffset = contest.freezeAt ? contest.freezeAt.getTime() - contest.startsAt.getTime() : 0;

  const byUserProblem = new Map<string, typeof subs>();
  for (const s of subs) {
    const k = `${s.userId}:${s.problemId}`;
    let list = byUserProblem.get(k);
    if (!list) byUserProblem.set(k, (list = []));
    list.push(s);
  }

  const boardProblems: BoardProblem[] = problems.map((p) => ({
    id: p.id,
    code: p.code,
    title: p.title,
    scorePrecision: p.scorePrecision,
    maxScoreCenti: p.activeTestSet ? p.activeTestSet.subtasks.reduce((a, s) => a + s.pointsCenti, 0) : null,
  }));

  if (contest.scoringMode === 'IOI') {
    const rows = participants.map((part) => {
      const w = participantWindow(contest, part);
      const freezeMs = w.start.getTime() + freezeOffset;
      const ioi: Record<string, IoiCell> = {};
      let total = 0;
      for (const p of problems) {
        const list = byUserProblem.get(`${part.userId}:${p.id}`) ?? [];
        const scored: SubmissionScore[] = [];
        let pending = 0;
        for (const s of list) {
          const j = s.judgements[0];
          const hidden = frozen && s.submittedAt.getTime() >= freezeMs;
          if (hidden || !j || !['DONE', 'CE', 'SE'].includes(j.status)) {
            pending++;
            continue;
          }
          if (j.status === 'DONE' && j.scoreCenti !== null) {
            scored.push({ totalCenti: j.scoreCenti, subtasks: (j.subtaskScores ?? []) as SubmissionScore['subtasks'] });
          }
        }
        const t = ioiTaskScore(contest.ioiTaskScoreRule, scored);
        ioi[p.id] = { scoreCenti: t.totalCenti, attempts: list.length, pending };
        total += t.totalCenti;
      }
      return { part, totalCenti: total, ioi };
    });
    const ranked = assignRanks(
      rows,
      (a, b) => b.totalCenti - a.totalCenti,
      (a, b) => a.part.user.displayName.localeCompare(b.part.user.displayName),
    );
    return {
      contestId,
      mode: 'IOI',
      frozen,
      freezeAt: contest.freezeAt?.toISOString() ?? null,
      generatedAt: new Date().toISOString(),
      problems: boardProblems,
      rows: ranked.map(({ row, rank }) => ({ rank, ...userFields(row.part.user), totalCenti: row.totalCenti, ioi: row.ioi })),
    };
  }

  const firstSolve = new Map<string, number>();
  const rows = participants.map((part) => {
    const w = participantWindow(contest, part);
    const freezeMs = w.start.getTime() + freezeOffset;
    const cells: Record<string, IcpcCell> = {};
    for (const p of problems) {
      const list = byUserProblem.get(`${part.userId}:${p.id}`) ?? [];
      const outcomes = list.map((s) => {
        const j = s.judgements[0];
        let outcome: IcpcOutcome = 'PENDING';
        if (frozen && s.submittedAt.getTime() >= freezeMs) outcome = 'PENDING';
        else if (!j) outcome = 'PENDING';
        else if (j.status === 'CE') outcome = 'CE';
        else if (j.status === 'SE') outcome = 'SE';
        else if (j.status === 'DONE') outcome = j.verdict === 'AC' ? 'AC' : j.verdict === 'SE' ? 'SE' : 'REJECTED';
        return { id: s.id, submittedAtMs: s.submittedAt.getTime(), outcome };
      });
      const state = icpcProblemState(outcomes, {
        startMs: w.start.getTime(),
        penaltyPerReject: contest.penaltyMinutes,
        countCompileErrors: contest.countCompileErrors,
      });
      cells[p.id] = { ...state, firstSolve: false, acElapsedMs: state.firstAcAtMs === null ? null : state.firstAcAtMs - w.start.getTime() };
      if (state.solved && state.solveMinute !== null) {
        const elapsed = state.firstAcAtMs! - w.start.getTime();
        if (elapsed < (firstSolve.get(p.id) ?? Infinity)) firstSolve.set(p.id, elapsed);
      }
    }
    const totals = icpcTotals(Object.values(cells));
    // Compare last-AC as elapsed contest time so personal start delays don't matter.
    return { part, cells, totals: { ...totals, lastAcAtMs: totals.lastAcAtMs ? totals.lastAcAtMs - w.start.getTime() : 0 } };
  });
  for (const r of rows) {
    const w = participantWindow(contest, r.part);
    for (const [pid, c] of Object.entries(r.cells)) {
      if (c.solved && c.firstAcAtMs! - w.start.getTime() === firstSolve.get(pid)) c.firstSolve = true;
    }
  }
  const ranked = assignRanks(
    rows,
    (a, b) => compareIcpcTotals(a.totals, b.totals),
    (a, b) => a.part.user.displayName.localeCompare(b.part.user.displayName),
  );
  return {
    contestId,
    mode: 'ICPC',
    frozen,
    freezeAt: contest.freezeAt?.toISOString() ?? null,
    generatedAt: new Date().toISOString(),
    problems: boardProblems,
    rows: ranked.map(({ row, rank }) => ({
      rank,
      ...userFields(row.part.user),
      solved: row.totals.solved,
      penalty: row.totals.penalty,
      icpc: row.cells,
    })),
  };
}

function userFields(u: { id: string; username: string; displayName: string; members: string; organization: string; region: string }) {
  return { userId: u.id, username: u.username, displayName: u.displayName, members: u.members, organization: u.organization, region: u.region };
}

export interface RankSeries {
  userId: string;
  username: string;
  displayName: string;
  organization: string;
  /** Rank at the end of every minute 0..lastMinute. */
  ranks: number[];
  /** IOI: total centi-points; ICPC: problems solved. */
  scores: number[];
  /** ICPC only. */
  penalties?: number[];
}

export interface RankHistory {
  contestId: string;
  mode: 'IOI' | 'ICPC';
  frozen: boolean;
  durationMinutes: number;
  /** Last minute with data (-1 before the start); capped at the freeze on frozen public boards. */
  lastMinute: number;
  freezeMinute: number | null;
  scorePrecision: number;
  generatedAt: string;
  series: RankSeries[];
}

export async function getRankHistory(contestId: string, full: boolean): Promise<RankHistory> {
  const key = `${contestId}:${full ? 'full' : 'public'}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.history;
  const history = await computeRankHistory(contestId, full);
  historyCache.set(key, { at: Date.now(), history });
  return history;
}

/**
 * Rank of every participant at each minute, counting judged submissions at the time they were
 * made (relative to each participant's own start). Pending submissions are ignored.
 */
async function computeRankHistory(contestId: string, full: boolean): Promise<RankHistory> {
  const { contest, problems, participants, subs } = await loadContestData(contestId, full);
  const now = Date.now();
  const startMs = contest.startsAt.getTime();
  const maxExtra = Math.max(0, ...participants.map((p) => p.extraTime));
  const durationMinutes = Math.ceil((contest.endsAt.getTime() - startMs + maxExtra * 1000) / 60_000);
  const freezeMinute = contest.freezeAt ? Math.max(0, Math.floor((contest.freezeAt.getTime() - startMs) / 60_000)) : null;
  const frozen = !full && contest.freezeAt !== null && now >= contest.freezeAt.getTime();
  let lastMinute = Math.min(durationMinutes, Math.floor((now - startMs) / 60_000));
  if (frozen && freezeMinute !== null) lastMinute = Math.min(lastMinute, freezeMinute);
  // While the contest runs, the newest point shows the current state rather than the last full minute.
  const live = lastMinute >= 0 && lastMinute < durationMinutes && !(frozen && lastMinute === freezeMinute);
  const cutoff = (m: number) => (live && m === lastMinute ? Infinity : m * 60_000);
  const ioi = contest.scoringMode === 'IOI';
  const pidIndex = new Map(problems.map((p, i) => [p.id, i]));
  const subsByUser = new Map<string, typeof subs>();
  for (const s of subs) {
    let list = subsByUser.get(s.userId);
    if (!list) subsByUser.set(s.userId, (list = []));
    list.push(s);
  }

  type Totals = { score: number; penalty: number; lastAc: number };
  const perUser = participants.map((part) => {
    const ws = participantWindow(contest, part).start.getTime();
    const events: { at: number; pi: number; ioi?: SubmissionScore; icpc?: IcpcSubmission }[] = [];
    for (const s of subsByUser.get(part.userId) ?? []) {
      const pi = pidIndex.get(s.problemId);
      const j = s.judgements[0];
      if (pi === undefined || !j || !['DONE', 'CE', 'SE'].includes(j.status)) continue;
      const at = Math.max(0, s.submittedAt.getTime() - ws);
      if (ioi) {
        if (j.status === 'DONE' && j.scoreCenti !== null) {
          events.push({ at, pi, ioi: { totalCenti: j.scoreCenti, subtasks: (j.subtaskScores ?? []) as SubmissionScore['subtasks'] } });
        }
      } else {
        const outcome: IcpcOutcome = j.status === 'CE' ? 'CE' : j.status === 'SE' || j.verdict === 'SE' ? 'SE' : j.verdict === 'AC' ? 'AC' : 'REJECTED';
        events.push({ at, pi, icpc: { id: s.id, submittedAtMs: at, outcome } });
      }
    }
    events.sort((a, b) => a.at - b.at);
    const ioiLists: SubmissionScore[][] = problems.map(() => []);
    const icpcLists: IcpcSubmission[][] = problems.map(() => []);
    const taskScores = problems.map(() => 0);
    const icpcCells: IcpcProblemState[] = problems.map(() => icpcProblemState([], { startMs: 0, penaltyPerReject: 0 }));
    const totals: Totals[] = [];
    let cur: Totals = { score: 0, penalty: 0, lastAc: 0 };
    let k = 0;
    for (let m = 0; m <= lastMinute; m++) {
      const dirty = new Set<number>();
      while (k < events.length && events[k].at < cutoff(m)) {
        const e = events[k++];
        if (e.ioi) ioiLists[e.pi].push(e.ioi);
        if (e.icpc) icpcLists[e.pi].push(e.icpc);
        dirty.add(e.pi);
      }
      if (dirty.size) {
        for (const pi of dirty) {
          if (ioi) taskScores[pi] = ioiTaskScore(contest.ioiTaskScoreRule, ioiLists[pi]).totalCenti;
          else icpcCells[pi] = icpcProblemState(icpcLists[pi], { startMs: 0, penaltyPerReject: contest.penaltyMinutes, countCompileErrors: contest.countCompileErrors });
        }
        if (ioi) cur = { score: taskScores.reduce((a, b) => a + b, 0), penalty: 0, lastAc: 0 };
        else {
          const t = icpcTotals(icpcCells);
          cur = { score: t.solved, penalty: t.penalty, lastAc: t.lastAcAtMs };
        }
      }
      totals.push(cur);
    }
    return { part, totals };
  });

  type Row = { i: number; t: Totals };
  const cmp = ioi
    ? (a: Row, b: Row) => b.t.score - a.t.score
    : (a: Row, b: Row) => compareIcpcTotals({ solved: a.t.score, penalty: a.t.penalty, lastAcAtMs: a.t.lastAc }, { solved: b.t.score, penalty: b.t.penalty, lastAcAtMs: b.t.lastAc });
  const ranks: number[][] = perUser.map(() => []);
  for (let m = 0; m <= lastMinute; m++) {
    const ranked = assignRanks(
      perUser.map((u, i) => ({ i, t: u.totals[m] })),
      cmp,
      (a, b) => perUser[a.i].part.user.displayName.localeCompare(perUser[b.i].part.user.displayName),
    );
    for (const { row, rank } of ranked) ranks[row.i].push(rank);
  }

  return {
    contestId,
    mode: contest.scoringMode,
    frozen,
    durationMinutes,
    lastMinute,
    freezeMinute,
    scorePrecision: Math.max(0, ...problems.map((p) => p.scorePrecision)),
    generatedAt: new Date().toISOString(),
    series: perUser.map((u, i) => ({
      userId: u.part.user.id,
      username: u.part.user.username,
      displayName: u.part.user.displayName,
      organization: u.part.user.organization,
      ranks: ranks[i],
      scores: u.totals.map((t) => t.score),
      ...(ioi ? {} : { penalties: u.totals.map((t) => t.penalty) }),
    })),
  };
}
