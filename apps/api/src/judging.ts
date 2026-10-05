import { randomBytes } from 'node:crypto';
import { QueueEvents, Worker } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { Prisma, TestVerdict } from '@prisma/client';
import {
  QUEUE_JUDGE,
  QUEUE_RESULTS,
  TEST_VERDICTS,
  scoreSubmission,
  type JudgeJob,
  type JudgeProgress,
  type JudgeResult,
  type Language,
  type SubtaskDef,
} from '@noi/shared';
import { prisma } from './db.js';
import { publish } from './events.js';
import { connection, judgeQueue, PRIORITY_LIVE } from './queue.js';
import { invalidateScoreboard } from './scoreboard.js';
import { HttpError } from './util.js';

/** Creates a new active judgement for a submission (against the problem's current test set) and queues it. */
export async function judgeSubmission(submissionId: string, priority = PRIORITY_LIVE): Promise<string> {
  const sub = await prisma.submission.findUniqueOrThrow({ where: { id: submissionId }, include: { problem: true } });
  const testSetId = sub.problem.activeTestSetId;
  if (!testSetId) throw new HttpError(409, `Problem ${sub.problem.code} has no test data yet`);
  const token = randomBytes(16).toString('hex');
  const judgement = await prisma.$transaction(async (tx) => {
    await tx.judgement.updateMany({ where: { submissionId, active: true }, data: { active: false } });
    return tx.judgement.create({ data: { submissionId, testSetId, token, active: true } });
  });
  const job = await buildJob(judgement.id);
  await judgeQueue.add('judge', job, {
    jobId: judgement.id,
    priority,
    attempts: 2,
    backoff: { type: 'fixed', delay: 2000 },
    removeOnComplete: 2000,
    removeOnFail: 5000,
  });
  invalidateScoreboard(sub.contestId);
  publish({ type: 'submission', contestId: sub.contestId, userId: sub.userId, data: { id: sub.id } });
  return judgement.id;
}

export async function buildJob(judgementId: string): Promise<JudgeJob> {
  const j = await prisma.judgement.findUniqueOrThrow({
    where: { id: judgementId },
    include: {
      submission: { include: { problem: true, contest: true } },
      testSet: {
        include: {
          tests: { orderBy: { ordinal: 'asc' } },
          subtasks: { orderBy: { ordinal: 'asc' }, include: { tests: true } },
        },
      },
    },
  });
  const { submission: sub, testSet } = j;
  const problem = sub.problem;
  const icpc = sub.contest.scoringMode === 'ICPC';
  let outputs: Record<string, string> | null = null;
  if (problem.type === 'OUTPUT_ONLY') {
    const byName = (sub.outputs ?? {}) as Record<string, string>;
    outputs = {};
    for (const t of testSet.tests) if (byName[t.name]) outputs[t.id] = byName[t.name];
  }
  return {
    judgementId: j.id,
    token: j.token,
    problemType: problem.type,
    language: (sub.language as Language | null) ?? null,
    sourceSha: sub.sourceSha,
    outputs,
    timeLimitMs: problem.timeLimitMs,
    memoryLimitMb: problem.memoryLimitMb,
    checker: { kind: problem.checkerKind, sourceSha: problem.checkerSha, epsilon: problem.checkerEpsilon },
    interactorSha: problem.interactorSha,
    tests: testSet.tests.map((t) => ({ id: t.id, inputSha: t.inputSha, answerSha: t.answerSha })),
    subtasks: icpc ? null : testSet.subtasks.map((s) => ({ testIds: s.tests.map((x) => x.testId), scoring: s.scoring })),
    stopOnFirstFailure: icpc,
  };
}

const FINAL = new Set(['DONE', 'CE', 'SE']);

export async function applyResult(result: JudgeResult, log: FastifyBaseLogger): Promise<void> {
  const j = await prisma.judgement.findUnique({
    where: { id: result.judgementId },
    include: { submission: true, testSet: { include: { tests: { select: { id: true } } } } },
  });
  if (!j || j.token !== result.token) {
    log.warn({ judgementId: result.judgementId }, 'Ignoring result with unknown judgement or bad token');
    return;
  }
  if (FINAL.has(j.status)) return; // duplicate delivery
  const valid = new Set(j.testSet.tests.map((t) => t.id));
  const rows = result.tests
    .filter((t) => valid.has(t.testId) && (TEST_VERDICTS as readonly string[]).includes(t.verdict))
    .map((t) => ({
      judgementId: j.id,
      testId: t.testId,
      verdict: t.verdict as TestVerdict,
      fractionPpm: Math.max(0, Math.min(1_000_000, Math.floor(t.fractionPpm))),
      timeMs: t.timeMs,
      memoryKb: t.memoryKb,
      message: t.message?.slice(0, 4000) ?? null,
    }));
  await prisma.$transaction(async (tx) => {
    await tx.testResult.deleteMany({ where: { judgementId: j.id } });
    if (rows.length) await tx.testResult.createMany({ data: rows });
    await tx.judgement.update({
      where: { id: j.id },
      data: {
        status: result.status,
        compileLog: result.compileLog?.slice(0, 64 * 1024) ?? null,
        error: result.error?.slice(0, 8000) ?? null,
        worker: result.worker,
        finishedAt: new Date(),
        progressDone: rows.length,
      },
    });
    await scoreJudgement(tx, j.id);
  });
  invalidateScoreboard(j.submission.contestId);
  publish({ type: 'submission', contestId: j.submission.contestId, userId: j.submission.userId, data: { id: j.submissionId } });
  publish({ type: 'scoreboard', contestId: j.submission.contestId, data: null });
}

/**
 * Derives score and overall verdict of a judgement from its stored per-test results. This is the only
 * place scores are computed, so editing subtasks or precision and re-running it is always consistent.
 */
export async function scoreJudgement(tx: Prisma.TransactionClient, judgementId: string): Promise<void> {
  const j = await tx.judgement.findUniqueOrThrow({
    where: { id: judgementId },
    include: {
      results: true,
      submission: { include: { problem: true, contest: true } },
      testSet: {
        include: {
          tests: { orderBy: { ordinal: 'asc' } },
          subtasks: { orderBy: { ordinal: 'asc' }, include: { tests: true } },
        },
      },
    },
  });
  if (j.status !== 'DONE') {
    const verdict = j.status === 'CE' || j.status === 'SE' ? j.status : null;
    await tx.judgement.update({ where: { id: j.id }, data: { verdict, scoreCenti: j.status === 'CE' ? 0 : null, subtaskScores: undefined } });
    return;
  }
  const byTest = new Map(j.results.map((r) => [r.testId, r]));
  const fractions = new Map(j.results.map((r) => [r.testId, r.fractionPpm]));
  const icpc = j.submission.contest.scoringMode === 'ICPC';
  let verdict = 'AC';
  for (const t of j.testSet.tests) {
    const r = byTest.get(t.id);
    if (!r || r.verdict === 'SKIPPED') continue;
    if (r.verdict !== 'AC') {
      verdict = icpc && r.verdict === 'PA' ? 'WA' : r.verdict;
      break;
    }
  }
  if (icpc && j.testSet.tests.some((t) => !byTest.has(t.id) || byTest.get(t.id)!.verdict === 'SKIPPED') && verdict === 'AC') {
    verdict = 'SE'; // never accept a submission that skipped tests
  }
  let scoreCenti: number | null = null;
  let subtaskScores: Prisma.InputJsonValue | undefined;
  if (!icpc) {
    const defs: SubtaskDef[] = j.testSet.subtasks.map((s) => ({
      id: s.id,
      pointsCenti: s.pointsCenti,
      scoring: s.scoring,
      testIds: s.tests.map((x) => x.testId),
    }));
    const score = scoreSubmission(defs, fractions, j.submission.problem.scorePrecision);
    scoreCenti = score.totalCenti;
    subtaskScores = score.subtasks;
  }
  const times = j.results.map((r) => r.timeMs ?? 0);
  const mems = j.results.map((r) => r.memoryKb ?? 0);
  await tx.judgement.update({
    where: { id: j.id },
    data: {
      verdict,
      scoreCenti,
      subtaskScores,
      maxTimeMs: times.length ? Math.max(...times) : null,
      maxMemoryKb: mems.length ? Math.max(...mems) : null,
    },
  });
}

/** Re-scores every finished judgement on a test set (after subtask or precision edits). */
export async function rescoreTestSet(testSetId: string): Promise<number> {
  const js = await prisma.judgement.findMany({ where: { testSetId, status: 'DONE' }, select: { id: true } });
  for (const { id } of js) await prisma.$transaction((tx) => scoreJudgement(tx, id), { timeout: 30_000 });
  const ts = await prisma.testSet.findUnique({ where: { id: testSetId }, include: { problem: true } });
  if (ts) {
    invalidateScoreboard(ts.problem.contestId);
    publish({ type: 'scoreboard', contestId: ts.problem.contestId, data: null });
  }
  return js.length;
}

export function startJudgingConsumers(log: FastifyBaseLogger): () => Promise<void> {
  const results = new Worker<JudgeResult>(QUEUE_RESULTS, async (job) => applyResult(job.data, log), { connection, concurrency: 4 });
  results.on('failed', (job, err) => log.error({ err, jobId: job?.id }, 'Failed to apply judge result'));

  const events = new QueueEvents(QUEUE_JUDGE, { connection });
  const lastWrite = new Map<string, number>();
  events.on('progress', async ({ jobId, data }) => {
    const p = data as unknown as JudgeProgress;
    if (!p || typeof p !== 'object' || !('stage' in p)) return;
    const now = Date.now();
    if (p.done !== p.total && now - (lastWrite.get(jobId) ?? 0) < 500) return;
    lastWrite.set(jobId, now);
    const j = await prisma.judgement
      .update({
        where: { id: jobId, status: { in: ['QUEUED', 'COMPILING', 'RUNNING'] } },
        data: { status: p.stage, progressDone: p.done, progressTotal: p.total },
        include: { submission: { select: { id: true, contestId: true, userId: true } } },
      })
      .catch(() => null);
    if (j) publish({ type: 'submission', contestId: j.submission.contestId, userId: j.submission.userId, data: { id: j.submission.id } });
  });
  events.on('completed', ({ jobId }) => lastWrite.delete(jobId));
  events.on('failed', async ({ jobId, failedReason }) => {
    lastWrite.delete(jobId);
    const job = await judgeQueue.getJob(jobId);
    if (job && job.attemptsMade < (job.opts.attempts ?? 1)) return; // will be retried
    const j = await prisma.judgement
      .update({
        where: { id: jobId, status: { in: ['QUEUED', 'COMPILING', 'RUNNING'] } },
        data: { status: 'SE', verdict: 'SE', error: `Worker failure: ${failedReason}`.slice(0, 8000), finishedAt: new Date() },
        include: { submission: true },
      })
      .catch(() => null);
    if (j) {
      invalidateScoreboard(j.submission.contestId);
      publish({ type: 'submission', contestId: j.submission.contestId, userId: j.submission.userId, data: { id: j.submissionId } });
    }
  });
  return async () => {
    await results.close();
    await events.close();
  };
}
