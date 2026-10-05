import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import yazl from 'yazl';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { LANGUAGES, type Language } from '@noi/shared';
import { requireUser, type AuthUser } from '../auth.js';
import { config } from '../config.js';
import { participantWindow, phaseOf } from '../contest.js';
import { prisma } from '../db.js';
import { bus, type BusEvent } from '../events.js';
import { judgeSubmission } from '../judging.js';
import { getScoreboard } from '../scoreboard.js';
import { putBuffer, putStream, readBlob, readBlobText, tmpPath } from '../storage.js';
import { HttpError } from '../util.js';
import { extractZip } from '../zip.js';

export async function contestAccess(user: AuthUser | null, contestId: string) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) throw new HttpError(404, 'Contest not found');
  const isAdmin = user?.role === 'ADMIN';
  const participant = user
    ? await prisma.contestParticipant.findUnique({ where: { contestId_userId: { contestId, userId: user.id } } })
    : null;
  if (!isAdmin && (!contest.visible || !participant)) throw new HttpError(404, 'Contest not found');
  const window = participantWindow(contest, participant);
  return { contest, participant, isAdmin, window, phase: phaseOf(window) };
}

function contestSummary(a: Awaited<ReturnType<typeof contestAccess>>) {
  const c = a.contest;
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    scoringMode: c.scoringMode,
    startsAt: a.window.start.toISOString(),
    endsAt: a.window.end.toISOString(),
    freezeAt: c.freezeAt?.toISOString() ?? null,
    phase: a.phase,
    penaltyMinutes: c.penaltyMinutes,
    maxSubmissionsPerTask: c.maxSubmissionsPerTask,
    languages: c.languages,
    publicScoreboard: c.publicScoreboard,
  };
}

async function problemAccess(req: FastifyRequest, contestId: string, problemId: string) {
  const user = requireUser(req);
  const a = await contestAccess(user, contestId);
  if (!a.isAdmin && a.phase === 'BEFORE') throw new HttpError(403, 'The contest has not started yet');
  const problem = await prisma.problem.findFirst({ where: { id: problemId, contestId } });
  if (!problem) throw new HttpError(404, 'Problem not found');
  return { ...a, user, problem };
}

/** Submissions that count toward the per-task limit: everything except system errors. */
async function countedSubmissions(db: Pick<typeof prisma, 'submission'>, contestId: string, userId: string, problemId: string) {
  return db.submission.count({
    where: { contestId, userId, problemId, NOT: { judgements: { some: { active: true, status: 'SE' } } } },
  });
}

export async function contestantRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/contests', async (req) => {
    const user = requireUser(req);
    const contests =
      user.role === 'ADMIN'
        ? await prisma.contest.findMany({ orderBy: { startsAt: 'desc' } })
        : await prisma.contest.findMany({
            where: { visible: true, participants: { some: { userId: user.id } } },
            orderBy: { startsAt: 'desc' },
          });
    const out = [];
    for (const c of contests) out.push(contestSummary(await contestAccess(user, c.id)));
    return out;
  });

  app.get<{ Params: { cid: string } }>('/api/contests/:cid', async (req) => {
    const user = requireUser(req);
    const a = await contestAccess(user, req.params.cid);
    const showProblems = a.isAdmin || a.phase !== 'BEFORE';
    const problems = showProblems
      ? await prisma.problem.findMany({
          where: { contestId: a.contest.id },
          orderBy: [{ ordinal: 'asc' }, { code: 'asc' }],
          include: { activeTestSet: { include: { subtasks: { select: { pointsCenti: true } } } } },
        })
      : [];
    const counts = await prisma.submission.groupBy({
      by: ['problemId'],
      where: { contestId: a.contest.id, userId: user.id },
      _count: true,
    });
    const countBy = new Map(counts.map((c) => [c.problemId, c._count]));
    let myScores: Record<string, unknown> = {};
    if (a.participant) {
      // The contestant's own scores ignore the freeze: they always see their own results.
      const board = await getScoreboard(a.contest.id, true);
      const row = board.rows.find((r) => r.userId === user.id);
      myScores = (row?.ioi ?? row?.icpc ?? {}) as Record<string, unknown>;
    }
    const announcements = await prisma.announcement.findMany({ where: { contestId: a.contest.id }, orderBy: { createdAt: 'desc' } });
    return {
      ...contestSummary(a),
      serverTime: new Date().toISOString(),
      problems: problems.map((p) => ({
        id: p.id,
        code: p.code,
        title: p.title,
        type: p.type,
        scorePrecision: p.scorePrecision,
        maxScoreCenti: p.activeTestSet?.subtasks.reduce((s, x) => s + x.pointsCenti, 0) ?? null,
        submissions: countBy.get(p.id) ?? 0,
        my: myScores[p.id] ?? null,
      })),
      announcements,
    };
  });

  app.get<{ Params: { cid: string; pid: string } }>('/api/contests/:cid/problems/:pid', async (req) => {
    const { problem: p, contest, user, isAdmin } = await problemAccess(req, req.params.cid, req.params.pid);
    const ts = p.activeTestSetId
      ? await prisma.testSet.findUnique({
          where: { id: p.activeTestSetId },
          include: {
            tests: { orderBy: { ordinal: 'asc' }, select: { id: true, name: true, isSample: true } },
            subtasks: { orderBy: { ordinal: 'asc' }, include: { tests: { select: { testId: true } } } },
          },
        })
      : null;
    const samples = [];
    for (const t of ts?.tests.filter((x) => x.isSample) ?? []) {
      const full = await prisma.test.findUniqueOrThrow({ where: { id: t.id } });
      samples.push({
        name: t.name,
        input: await readBlobText(full.inputSha, 64 * 1024),
        output: full.answerSha ? await readBlobText(full.answerSha, 64 * 1024) : null,
      });
    }
    const used = await countedSubmissions(prisma, contest.id, user.id, p.id);
    return {
      id: p.id,
      code: p.code,
      title: p.title,
      type: p.type,
      timeLimitMs: p.timeLimitMs,
      memoryLimitMb: p.memoryLimitMb,
      scorePrecision: p.scorePrecision,
      statementMd: p.statementMd,
      hasStatementFile: !!p.statementSha,
      statementType: p.statementType,
      hasAttachments: !!p.attachmentSha,
      scoringMode: contest.scoringMode,
      languages: contest.languages,
      subtasks:
        contest.scoringMode === 'IOI'
          ? (ts?.subtasks ?? []).map((s) => ({ id: s.id, ordinal: s.ordinal, name: s.name, pointsCenti: s.pointsCenti, scoring: s.scoring, testCount: s.tests.length }))
          : [],
      maxScoreCenti: ts ? ts.subtasks.reduce((a, s) => a + s.pointsCenti, 0) : null,
      outputOnlyTests: p.type === 'OUTPUT_ONLY' ? (ts?.tests ?? []).map((t) => t.name) : [],
      samples,
      submissionsUsed: used,
      submissionLimit: isAdmin ? null : contest.maxSubmissionsPerTask,
    };
  });

  app.get<{ Params: { cid: string; pid: string } }>('/api/contests/:cid/problems/:pid/statement', async (req, reply) => {
    const { problem: p } = await problemAccess(req, req.params.cid, req.params.pid);
    if (!p.statementSha) throw new HttpError(404, 'No statement file');
    reply.type(p.statementType ?? 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${p.code}.pdf"`);
    return reply.send(readBlob(p.statementSha));
  });

  app.get<{ Params: { cid: string; pid: string } }>('/api/contests/:cid/problems/:pid/attachments', async (req, reply) => {
    const { problem: p } = await problemAccess(req, req.params.cid, req.params.pid);
    if (!p.attachmentSha) throw new HttpError(404, 'No attachments');
    reply.type('application/zip');
    reply.header('Content-Disposition', `attachment; filename="${p.code}-attachments.zip"`);
    return reply.send(readBlob(p.attachmentSha));
  });

  // Output-only: all inputs as one zip.
  app.get<{ Params: { cid: string; pid: string } }>('/api/contests/:cid/problems/:pid/inputs.zip', async (req, reply) => {
    const { problem: p } = await problemAccess(req, req.params.cid, req.params.pid);
    if (p.type !== 'OUTPUT_ONLY' || !p.activeTestSetId) throw new HttpError(404, 'Not an output-only problem');
    const tests = await prisma.test.findMany({ where: { testSetId: p.activeTestSetId }, orderBy: { ordinal: 'asc' } });
    const zip = new yazl.ZipFile();
    for (const t of tests) zip.addReadStream(readBlob(t.inputSha), `${t.name}.in`);
    zip.end();
    reply.type('application/zip');
    reply.header('Content-Disposition', `attachment; filename="${p.code}-inputs.zip"`);
    return reply.send(zip.outputStream);
  });

  app.post<{ Params: { cid: string; pid: string } }>(
    '/api/contests/:cid/problems/:pid/submit',
    {
      config: {
        rateLimit: { max: config.submitPerMinute, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip },
      },
    },
    async (req) => {
      const { problem: p, contest, user, isAdmin, phase, participant } = await problemAccess(req, req.params.cid, req.params.pid);
      if (!isAdmin) {
        if (!participant) throw new HttpError(403, 'You are not registered for this contest');
        if (phase !== 'RUNNING') throw new HttpError(403, phase === 'BEFORE' ? 'The contest has not started' : 'The contest is over');
      }
      if (!p.activeTestSetId) throw new HttpError(409, 'This problem is not ready for submissions yet');

      let language: string | null = null;
      let code: string | null = null;
      const uploads: { name: string; sha: string; size: number }[] = [];
      let sourceSha: string | null = null;
      for await (const part of req.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'language') language = String(part.value);
          if (part.fieldname === 'code') code = String(part.value);
          continue;
        }
        const file = part as MultipartFile;
        if (p.type === 'OUTPUT_ONLY') {
          if (/\.zip$/i.test(file.filename)) {
            const t = tmpPath();
            await pipeline(file.file, createWriteStream(t));
            try {
              const entries = await extractZip(t, config.maxOutputBytes * 4, config.maxOutputBytes);
              for (const e of entries) uploads.push({ name: e.name, sha: e.sha, size: e.size });
            } finally {
              await fs.rm(t, { force: true });
            }
          } else {
            const r = await putStream(file.file, config.maxOutputBytes);
            uploads.push({ name: path.basename(file.filename), ...r });
          }
        } else {
          const r = await putStream(file.file, config.maxSourceBytes);
          sourceSha = r.sha;
        }
      }

      let outputs: Record<string, string> | null = null;
      if (p.type === 'OUTPUT_ONLY') {
        const tests = await prisma.test.findMany({ where: { testSetId: p.activeTestSetId }, select: { name: true } });
        const names = new Set(tests.map((t) => t.name));
        outputs = {};
        for (const u of uploads) {
          const stem = u.name.replace(/\.(out|ans|txt|sol)$/i, '');
          if (names.has(stem)) outputs[stem] = u.sha;
        }
        if (Object.keys(outputs).length === 0) {
          throw new HttpError(400, `No uploaded file matches a test. Name output files like ${[...names][0] ?? 'NAME'}.out`);
        }
      } else {
        if (!language || !(LANGUAGES as readonly string[]).includes(language)) throw new HttpError(400, 'Choose a language');
        if (!contest.languages.includes(language)) throw new HttpError(400, 'This language is not allowed in this contest');
        if (code !== null && !sourceSha) {
          if (Buffer.byteLength(code) > config.maxSourceBytes) throw new HttpError(413, 'Source code is too large');
          if (!code.trim()) throw new HttpError(400, 'Source code is empty');
          sourceSha = (await putBuffer(code)).sha;
        }
        if (!sourceSha) throw new HttpError(400, 'No source code provided');
      }

      const limit = isAdmin ? null : contest.maxSubmissionsPerTask;
      const sub = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${user.id}:${p.id}`}))::text`;
        if (limit !== null) {
          const used = await countedSubmissions(tx, contest.id, user.id, p.id);
          if (used >= limit) throw new HttpError(429, `Submission limit reached (${limit} per task)`);
        }
        return tx.submission.create({
          data: {
            contestId: contest.id,
            problemId: p.id,
            userId: user.id,
            language: p.type === 'OUTPUT_ONLY' ? null : (language as Language),
            sourceSha,
            outputs: outputs ?? undefined,
          },
        });
      });
      await judgeSubmission(sub.id);
      return { id: sub.id };
    },
  );

  app.get<{ Params: { cid: string }; Querystring: { problemId?: string } }>('/api/contests/:cid/submissions', async (req) => {
    const user = requireUser(req);
    const a = await contestAccess(user, req.params.cid);
    const subs = await prisma.submission.findMany({
      where: { contestId: a.contest.id, userId: user.id, ...(req.query.problemId ? { problemId: req.query.problemId } : {}) },
      orderBy: { submittedAt: 'desc' },
      take: 500,
      include: { problem: { select: { code: true, title: true, scorePrecision: true } }, judgements: { where: { active: true } } },
    });
    return subs.map(listItem);
  });

  app.get<{ Params: { sid: string } }>('/api/submissions/:sid', async (req) => {
    const user = requireUser(req);
    const detail = await submissionDetail(req.params.sid, user);
    return detail;
  });

  app.get<{ Params: { sid: string } }>('/api/submissions/:sid/source', async (req, reply) => {
    const user = requireUser(req);
    const sub = await prisma.submission.findUnique({ where: { id: req.params.sid } });
    if (!sub || (sub.userId !== user.id && user.role !== 'ADMIN') || !sub.sourceSha) throw new HttpError(404, 'Not found');
    reply.type('text/plain; charset=utf-8');
    return reply.send(readBlob(sub.sourceSha));
  });

  app.get<{ Params: { cid: string } }>('/api/contests/:cid/scoreboard', async (req) => {
    const contest = await prisma.contest.findUnique({ where: { id: req.params.cid } });
    if (!contest) throw new HttpError(404, 'Contest not found');
    const isAdmin = req.user?.role === 'ADMIN';
    if (!isAdmin && (!contest.visible || !contest.publicScoreboard)) throw new HttpError(403, 'The scoreboard is not public');
    return { contest: { id: contest.id, name: contest.name, scoringMode: contest.scoringMode, startsAt: contest.startsAt, endsAt: contest.endsAt }, ...(await getScoreboard(contest.id, isAdmin)) };
  });

  app.get<{ Params: { cid: string } }>('/api/contests/:cid/announcements', async (req) => {
    const a = await contestAccess(requireUser(req), req.params.cid);
    return prisma.announcement.findMany({ where: { contestId: a.contest.id }, orderBy: { createdAt: 'desc' } });
  });

  app.get<{ Querystring: { contestId?: string } }>('/api/events', async (req, reply) => {
    const user = req.user;
    const contestId = req.query.contestId ?? null;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const onEvent = (e: BusEvent) => {
      if (contestId && e.contestId && e.contestId !== contestId) return;
      if (e.userId && (!user || (e.userId !== user.id && user.role !== 'ADMIN'))) return;
      if (e.type === 'queue' && user?.role !== 'ADMIN') return;
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data ?? null)}\n\n`);
    };
    bus.on('event', onEvent);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('event', onEvent);
    });
  });
}

type SubWithJ = Awaited<ReturnType<typeof prisma.submission.findMany<{ include: { problem: { select: { code: true; title: true; scorePrecision: true } }; judgements: true } }>>>[number];

export function listItem(s: SubWithJ & { user?: { username: string; displayName: string } }) {
  const j = s.judgements[0];
  return {
    id: s.id,
    problemId: s.problemId,
    problemCode: s.problem.code,
    problemTitle: s.problem.title,
    scorePrecision: s.problem.scorePrecision,
    language: s.language,
    submittedAt: s.submittedAt,
    status: j?.status ?? 'QUEUED',
    verdict: j?.verdict ?? null,
    scoreCenti: j?.scoreCenti ?? null,
    maxTimeMs: j?.maxTimeMs ?? null,
    maxMemoryKb: j?.maxMemoryKb ?? null,
    progressDone: j?.progressDone ?? 0,
    progressTotal: j?.progressTotal ?? 0,
    user: s.user ? { username: s.user.username, displayName: s.user.displayName } : undefined,
  };
}

export async function submissionDetail(id: string, viewer: AuthUser) {
  const s = await prisma.submission.findUnique({
    where: { id },
    include: {
      user: { select: { username: true, displayName: true } },
      contest: { select: { scoringMode: true, name: true } },
      problem: { select: { code: true, title: true, scorePrecision: true, type: true } },
      judgements: {
        where: { active: true },
        include: {
          results: true,
          testSet: {
            include: {
              tests: { orderBy: { ordinal: 'asc' }, select: { id: true, name: true, isSample: true } },
              subtasks: { orderBy: { ordinal: 'asc' }, include: { tests: { select: { testId: true } } } },
            },
          },
        },
      },
    },
  });
  const isAdmin = viewer.role === 'ADMIN';
  if (!s || (s.userId !== viewer.id && !isAdmin)) throw new HttpError(404, 'Submission not found');
  const j = s.judgements[0];
  const results = new Map((j?.results ?? []).map((r) => [r.testId, r]));
  const subtaskScores = new Map(((j?.subtaskScores ?? []) as { id: string; scoreCenti: number }[]).map((x) => [x.id, x.scoreCenti]));
  const source = s.sourceSha ? await readBlobText(s.sourceSha, config.maxSourceBytes) : null;
  return {
    id: s.id,
    contestId: s.contestId,
    contestName: s.contest.name,
    scoringMode: s.contest.scoringMode,
    problemId: s.problemId,
    problemCode: s.problem.code,
    problemTitle: s.problem.title,
    problemType: s.problem.type,
    scorePrecision: s.problem.scorePrecision,
    user: s.user,
    language: s.language,
    submittedAt: s.submittedAt,
    source,
    outputs: s.outputs ? Object.keys(s.outputs as object) : null,
    status: j?.status ?? 'QUEUED',
    verdict: j?.verdict ?? null,
    scoreCenti: j?.scoreCenti ?? null,
    compileLog: j?.compileLog ?? null,
    error: isAdmin ? (j?.error ?? null) : null,
    worker: isAdmin ? (j?.worker ?? null) : null,
    progressDone: j?.progressDone ?? 0,
    progressTotal: j?.progressTotal ?? 0,
    tests: (j?.testSet.tests ?? []).map((t) => {
      const r = results.get(t.id);
      return {
        id: t.id,
        name: t.name,
        isSample: t.isSample,
        verdict: r?.verdict ?? null,
        fractionPpm: r?.fractionPpm ?? null,
        timeMs: r?.timeMs ?? null,
        memoryKb: r?.memoryKb ?? null,
        message: isAdmin ? (r?.message ?? null) : null,
      };
    }),
    subtasks:
      s.contest.scoringMode === 'IOI'
        ? (j?.testSet.subtasks ?? []).map((st) => ({
            id: st.id,
            ordinal: st.ordinal,
            name: st.name,
            scoring: st.scoring,
            pointsCenti: st.pointsCenti,
            scoreCenti: subtaskScores.get(st.id) ?? null,
            testIds: st.tests.map((x) => x.testId),
          }))
        : [],
  };
}
