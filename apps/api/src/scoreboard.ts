import {
  assignRanks,
  compareIcpcTotals,
  icpcProblemState,
  icpcTotals,
  ioiTaskScore,
  type IcpcOutcome,
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
  icpc?: Record<string, IcpcProblemState & { firstSolve: boolean }>;
}

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

export function invalidateScoreboard(contestId: string): void {
  cache.delete(`${contestId}:full`);
  cache.delete(`${contestId}:public`);
}

/**
 * Builds the scoreboard from the active judgement of every submission. `full` boards (admins)
 * ignore the freeze; public boards hide results of submissions made after the freeze time.
 */
export async function getScoreboard(contestId: string, full: boolean): Promise<Board> {
  const key = `${contestId}:${full ? 'full' : 'public'}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.board;
  const board = await computeScoreboard(contestId, full);
  cache.set(key, { at: Date.now(), board });
  return board;
}

async function computeScoreboard(contestId: string, full: boolean): Promise<Board> {
  const contest = await prisma.contest.findUniqueOrThrow({ where: { id: contestId } });
  const problems = await prisma.problem.findMany({
    where: { contestId },
    orderBy: [{ ordinal: 'asc' }, { code: 'asc' }],
    include: { activeTestSet: { include: { subtasks: { select: { pointsCenti: true } } } } },
  });
  const participants = await prisma.contestParticipant.findMany({
    where: { contestId, ...(full ? {} : { hidden: false }), user: { role: 'CONTESTANT' } },
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
  const now = Date.now();
  const frozen = !full && contest.freezeAt !== null && now >= contest.freezeAt.getTime();
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
    const cells: Record<string, IcpcProblemState & { firstSolve: boolean }> = {};
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
      cells[p.id] = { ...state, firstSolve: false };
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
