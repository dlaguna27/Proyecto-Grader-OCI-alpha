import type { FastifyInstance } from 'fastify';
import { JudgementStatus, Prisma } from '@prisma/client';
import type { MultipartFile } from '@fastify/multipart';
import { createWriteStream, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { assignBalloonColors, BALLOON_HEX_RE, formatScore, parseScore, LANGUAGES } from '@noi/shared';
import { adminOnly, generatePassword, hashPassword, requireAdmin } from '../auth.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { publish } from '../events.js';
import { judgeSubmission, rescoreTestSet } from '../judging.js';
import { judgeQueue, PRIORITY_REJUDGE } from '../queue.js';
import { getRevealBoards, getScoreboard, invalidateScoreboard } from '../scoreboard.js';
import { putStream, readBlob, tmpPath } from '../storage.js';
import { audit, csvEscape, HttpError, parseCsv } from '../util.js';
import { extractZip, pairTests } from '../zip.js';
import { listItem, submissionDetail } from './contestant.js';

const UserBody = z.object({
  username: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/, 'Username may only contain letters, digits, _ . -'),
  password: z.string().min(4).max(200).optional(),
  displayName: z.string().trim().max(200).optional(),
  members: z.string().max(1000).optional(),
  organization: z.string().max(200).optional(),
  region: z.string().max(200).optional(),
  role: z.enum(['ADMIN', 'CONTESTANT']).optional(),
});

const ContestBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(20000).optional(),
  scoringMode: z.enum(['IOI', 'ICPC']),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  freezeAt: z.coerce.date().nullable().optional(),
  penaltyMinutes: z.number().int().min(0).max(1000).optional(),
  countCompileErrors: z.boolean().optional(),
  ioiTaskScoreRule: z.enum(['MAX_SUBTASK', 'BEST_SUBMISSION']).optional(),
  maxSubmissionsPerTask: z.number().int().min(1).max(10000).nullable().optional(),
  languages: z.array(z.enum(LANGUAGES)).min(1).optional(),
  visible: z.boolean().optional(),
  publicScoreboard: z.boolean().optional(),
  balloonPalette: z.enum(['ICPC', 'CUSTOM']).optional(),
});

const ProblemBody = z.object({
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/),
  title: z.string().trim().min(1).max(200),
  ordinal: z.number().int().optional(),
  type: z.enum(['BATCH', 'OUTPUT_ONLY', 'INTERACTIVE']).optional(),
  timeLimitMs: z.number().int().min(100).max(60_000).optional(),
  memoryLimitMb: z.number().int().min(16).max(4096).optional(),
  scorePrecision: z.number().int().min(0).max(2).optional(),
  balloonColor: z.string().regex(BALLOON_HEX_RE, 'Use a #rrggbb color').nullable().optional(),
  checkerKind: z.enum(['TOKENS', 'FLOAT', 'CUSTOM']).optional(),
  checkerEpsilon: z.number().positive().max(1).nullable().optional(),
  statementMd: z.string().max(200_000).optional(),
});

const SubtasksBody = z.object({
  subtasks: z
    .array(
      z.object({
        name: z.string().max(500).default(''),
        points: z.union([z.string(), z.number()]),
        scoring: z.enum(['MIN', 'SUM']).default('MIN'),
        tests: z.array(z.string()).min(1, 'Each subtask needs at least one test'),
      }),
    )
    .max(100),
});

const ParticipantBody = z.object({
  startDelay: z.number().int().min(0).max(30 * 24 * 3600).optional(),
  extraTime: z.number().int().min(0).max(30 * 24 * 3600).optional(),
  hidden: z.boolean().optional(),
});

async function saveUpload(file: MultipartFile, maxBytes: number) {
  return putStream(file.file, maxBytes);
}

async function singleFile(req: Parameters<typeof requireAdmin>[0]) {
  const file = await req.file();
  if (!file) throw new HttpError(400, 'No file uploaded');
  return file;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', adminOnly);

  /* ---------------- Users ---------------- */
  app.get('/api/admin/users', async () =>
    prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { username: 'asc' }],
      select: { id: true, username: true, role: true, displayName: true, members: true, organization: true, region: true, createdAt: true },
    }),
  );

  app.post('/api/admin/users', async (req) => {
    const body = UserBody.parse(req.body);
    const password = body.password ?? generatePassword();
    const user = await prisma.user.create({
      data: {
        username: body.username,
        passwordHash: await hashPassword(password),
        displayName: body.displayName || body.username,
        members: body.members ?? '',
        organization: body.organization ?? '',
        region: body.region ?? '',
        role: body.role ?? 'CONTESTANT',
      },
    });
    await audit(req.user!.id, 'user_create', { username: user.username });
    return { id: user.id, username: user.username, password };
  });

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
    const body = UserBody.partial().parse(req.body);
    if (body.role === 'CONTESTANT' && req.params.id === req.user!.id) throw new HttpError(400, 'You cannot demote yourself');
    const data: Record<string, unknown> = { ...body };
    delete data.password;
    if (body.password) data.passwordHash = await hashPassword(body.password);
    const u = await prisma.user.update({ where: { id: req.params.id }, data });
    if (body.password) await prisma.session.deleteMany({ where: { userId: u.id } });
    await audit(req.user!.id, 'user_update', { username: u.username });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/reset-password', async (req) => {
    const password = generatePassword();
    const u = await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash: await hashPassword(password) } });
    await prisma.session.deleteMany({ where: { userId: u.id } });
    await audit(req.user!.id, 'user_reset_password', { username: u.username });
    return { username: u.username, password };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
    if (req.params.id === req.user!.id) throw new HttpError(400, 'You cannot delete yourself');
    const u = await prisma.user.delete({ where: { id: req.params.id } });
    await audit(req.user!.id, 'user_delete', { username: u.username });
    return { ok: true };
  });

  /**
   * CSV import: username,password,displayName,members,organization,region (header optional).
   * Empty passwords are generated and returned once so they can be printed.
   */
  app.post('/api/admin/users/import', async (req) => {
    const body = z.object({ csv: z.string().max(5_000_000), contestId: z.string().optional() }).parse(req.body);
    const rows = parseCsv(body.csv);
    if (rows.length && rows[0][0]?.trim().toLowerCase() === 'username') rows.shift();
    const created: { username: string; password: string; displayName: string }[] = [];
    const errors: string[] = [];
    for (const [i, r] of rows.entries()) {
      const [username = '', password = '', displayName = '', members = '', organization = '', region = ''] = r.map((x) => x.trim());
      const parsed = UserBody.safeParse({ username, password: password || undefined });
      if (!parsed.success) {
        errors.push(`Row ${i + 1}: ${parsed.error.issues[0].message}`);
        continue;
      }
      const pw = password || generatePassword();
      try {
        const u = await prisma.user.create({
          data: { username, passwordHash: await hashPassword(pw), displayName: displayName || username, members, organization, region },
        });
        if (body.contestId) await prisma.contestParticipant.create({ data: { contestId: body.contestId, userId: u.id } });
        created.push({ username, password: pw, displayName: displayName || username });
      } catch {
        errors.push(`Row ${i + 1}: username "${username}" already exists`);
      }
    }
    await audit(req.user!.id, 'user_import', { created: created.length, errors: errors.length });
    return { created, errors };
  });

  /* ---------------- Contests ---------------- */
  app.get('/api/admin/contests', async () =>
    prisma.contest.findMany({ orderBy: { startsAt: 'desc' }, include: { _count: { select: { problems: true, participants: true, submissions: true } } } }),
  );

  app.post('/api/admin/contests', async (req) => {
    const body = ContestBody.parse(req.body);
    if (body.endsAt <= body.startsAt) throw new HttpError(400, 'The contest must end after it starts');
    const maxSubs = body.maxSubmissionsPerTask !== undefined ? body.maxSubmissionsPerTask : body.scoringMode === 'IOI' ? 50 : null;
    const c = await prisma.contest.create({ data: { ...body, maxSubmissionsPerTask: maxSubs } });
    await audit(req.user!.id, 'contest_create', { id: c.id, name: c.name });
    return c;
  });

  app.get<{ Params: { id: string } }>('/api/admin/contests/:id', async (req) => {
    const c = await prisma.contest.findUnique({
      where: { id: req.params.id },
      include: {
        problems: { orderBy: [{ ordinal: 'asc' }, { code: 'asc' }], include: { activeTestSet: { include: { _count: { select: { tests: true } }, subtasks: { select: { pointsCenti: true } } } } } },
        _count: { select: { participants: true, submissions: true } },
        announcements: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!c) throw new HttpError(404, 'Contest not found');
    const colors = assignBalloonColors(c.balloonPalette, c.problems);
    return {
      ...c,
      problems: c.problems.map((p) => ({
        id: p.id,
        code: p.code,
        title: p.title,
        type: p.type,
        ordinal: p.ordinal,
        timeLimitMs: p.timeLimitMs,
        memoryLimitMb: p.memoryLimitMb,
        scorePrecision: p.scorePrecision,
        balloonColor: p.balloonColor,
        color: colors.get(p.id)!,
        testCount: p.activeTestSet?._count.tests ?? 0,
        maxScoreCenti: p.activeTestSet?.subtasks.reduce((a, s) => a + s.pointsCenti, 0) ?? null,
      })),
    };
  });

  app.patch<{ Params: { id: string } }>('/api/admin/contests/:id', async (req) => {
    const body = ContestBody.partial().parse(req.body);
    const c = await prisma.contest.findUnique({ where: { id: req.params.id }, include: { _count: { select: { submissions: true } } } });
    if (!c) throw new HttpError(404, 'Contest not found');
    if (body.scoringMode && body.scoringMode !== c.scoringMode && c._count.submissions > 0) {
      throw new HttpError(409, 'The scoring mode cannot be changed after submissions exist');
    }
    const starts = body.startsAt ?? c.startsAt;
    const ends = body.endsAt ?? c.endsAt;
    if (ends <= starts) throw new HttpError(400, 'The contest must end after it starts');
    const updated = await prisma.contest.update({ where: { id: c.id }, data: body });
    invalidateScoreboard(c.id);
    publish({ type: 'scoreboard', contestId: c.id, data: null });
    await audit(req.user!.id, 'contest_update', { id: c.id, fields: Object.keys(body) });
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/admin/contests/:id', async (req) => {
    const c = await prisma.contest.delete({ where: { id: req.params.id } });
    await audit(req.user!.id, 'contest_delete', { id: c.id, name: c.name });
    return { ok: true };
  });

  /* ---------------- Participants ---------------- */
  app.get<{ Params: { id: string } }>('/api/admin/contests/:id/participants', async (req) =>
    prisma.contestParticipant.findMany({
      where: { contestId: req.params.id },
      include: { user: { select: { id: true, username: true, displayName: true, organization: true, region: true, role: true } } },
      orderBy: { user: { username: 'asc' } },
    }),
  );

  app.post<{ Params: { id: string } }>('/api/admin/contests/:id/participants', async (req) => {
    const body = z.object({ userIds: z.array(z.string()).optional(), allContestants: z.boolean().optional() }).parse(req.body);
    const ids = body.allContestants
      ? (await prisma.user.findMany({ where: { role: 'CONTESTANT' }, select: { id: true } })).map((u) => u.id)
      : (body.userIds ?? []);
    const r = await prisma.contestParticipant.createMany({ data: ids.map((userId) => ({ contestId: req.params.id, userId })), skipDuplicates: true });
    invalidateScoreboard(req.params.id);
    return { added: r.count };
  });

  app.patch<{ Params: { id: string; uid: string } }>('/api/admin/contests/:id/participants/:uid', async (req) => {
    const body = ParticipantBody.parse(req.body);
    await prisma.contestParticipant.update({ where: { contestId_userId: { contestId: req.params.id, userId: req.params.uid } }, data: body });
    invalidateScoreboard(req.params.id);
    await audit(req.user!.id, 'participant_update', { contestId: req.params.id, userId: req.params.uid, ...body });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; uid: string } }>('/api/admin/contests/:id/participants/:uid', async (req) => {
    await prisma.contestParticipant.delete({ where: { contestId_userId: { contestId: req.params.id, userId: req.params.uid } } });
    invalidateScoreboard(req.params.id);
    return { ok: true };
  });

  /* ---------------- Announcements ---------------- */
  app.post<{ Params: { id: string } }>('/api/admin/contests/:id/announcements', async (req) => {
    const body = z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(20000).default('') }).parse(req.body);
    const a = await prisma.announcement.create({ data: { contestId: req.params.id, ...body } });
    publish({ type: 'announcement', contestId: req.params.id, data: a });
    return a;
  });

  app.delete<{ Params: { id: string; aid: string } }>('/api/admin/contests/:id/announcements/:aid', async (req) => {
    await prisma.announcement.delete({ where: { id: req.params.aid } });
    publish({ type: 'announcement', contestId: req.params.id, data: null });
    return { ok: true };
  });

  /* ---------------- Problems ---------------- */
  app.post<{ Params: { id: string } }>('/api/admin/contests/:id/problems', async (req) => {
    const body = ProblemBody.parse(req.body);
    const count = await prisma.problem.count({ where: { contestId: req.params.id } });
    const p = await prisma.problem.create({ data: { ...body, ordinal: body.ordinal ?? count, contestId: req.params.id } });
    await audit(req.user!.id, 'problem_create', { id: p.id, code: p.code });
    return p;
  });

  app.get<{ Params: { pid: string } }>('/api/admin/problems/:pid', async (req) => {
    const p = await prisma.problem.findUnique({
      where: { id: req.params.pid },
      include: {
        contest: { select: { id: true, name: true, scoringMode: true, balloonPalette: true } },
        testSets: { orderBy: { createdAt: 'desc' }, include: { _count: { select: { tests: true, judgements: true } } } },
      },
    });
    if (!p) throw new HttpError(404, 'Problem not found');
    const siblings = await prisma.problem.findMany({
      where: { contestId: p.contestId },
      orderBy: [{ ordinal: 'asc' }, { code: 'asc' }],
      select: { id: true, balloonColor: true },
    });
    const active = p.activeTestSetId
      ? await prisma.testSet.findUnique({
          where: { id: p.activeTestSetId },
          include: {
            tests: { orderBy: { ordinal: 'asc' } },
            subtasks: { orderBy: { ordinal: 'asc' }, include: { tests: { include: { test: { select: { name: true } } } } } },
          },
        })
      : null;
    return {
      ...p,
      color: assignBalloonColors(p.contest.balloonPalette, siblings).get(p.id)!,
      activeTestSet: active && {
        id: active.id,
        createdAt: active.createdAt,
        note: active.note,
        tests: active.tests.map((t) => ({ id: t.id, name: t.name, isSample: t.isSample, inputSize: t.inputSize, hasAnswer: !!t.answerSha })),
        subtasks: active.subtasks.map((s) => ({
          id: s.id,
          ordinal: s.ordinal,
          name: s.name,
          scoring: s.scoring,
          pointsCenti: s.pointsCenti,
          points: formatScore(s.pointsCenti, p.scorePrecision),
          tests: s.tests.map((x) => x.test.name),
        })),
      },
    };
  });

  app.patch<{ Params: { pid: string } }>('/api/admin/problems/:pid', async (req) => {
    const body = ProblemBody.partial().parse(req.body);
    const before = await prisma.problem.findUniqueOrThrow({ where: { id: req.params.pid } });
    if (body.checkerKind === 'CUSTOM' && !before.checkerSha) throw new HttpError(400, 'Upload a checker first');
    if (body.scorePrecision !== undefined && body.scorePrecision < before.scorePrecision && before.activeTestSetId) {
      const subs = await prisma.subtask.findMany({ where: { testSetId: before.activeTestSetId } });
      const step = 10 ** (2 - body.scorePrecision);
      if (subs.some((s) => s.pointsCenti % step !== 0)) {
        throw new HttpError(400, 'Some subtask points have more decimals than the new precision allows; edit them first');
      }
    }
    const p = await prisma.problem.update({ where: { id: req.params.pid }, data: body });
    if (body.scorePrecision !== undefined && body.scorePrecision !== before.scorePrecision) {
      for (const ts of await prisma.testSet.findMany({ where: { problemId: p.id }, select: { id: true } })) await rescoreTestSet(ts.id);
    }
    invalidateScoreboard(p.contestId);
    await audit(req.user!.id, 'problem_update', { id: p.id, fields: Object.keys(body) });
    return p;
  });

  app.delete<{ Params: { pid: string } }>('/api/admin/problems/:pid', async (req) => {
    const p = await prisma.problem.delete({ where: { id: req.params.pid } });
    invalidateScoreboard(p.contestId);
    await audit(req.user!.id, 'problem_delete', { id: p.id, code: p.code });
    return { ok: true };
  });

  /** Upload a zip of tests: creates a new immutable test set and makes it active. */
  app.post<{ Params: { pid: string }; Querystring: { rejudge?: string } }>('/api/admin/problems/:pid/tests', async (req) => {
    const p = await prisma.problem.findUniqueOrThrow({ where: { id: req.params.pid }, include: { contest: true } });
    const file = await singleFile(req);
    const t = tmpPath();
    await pipeline(file.file, createWriteStream(t));
    if (file.file.truncated) throw new HttpError(413, 'Zip is too large');
    let parsed;
    try {
      const files = await extractZip(t, config.maxZipBytes * 4, config.maxZipBytes);
      parsed = pairTests(files, p.type !== 'INTERACTIVE');
    } finally {
      await fs.rm(t, { force: true });
    }
    const { tests, warnings } = parsed;
    const prev = p.activeTestSetId
      ? await prisma.testSet.findUnique({ where: { id: p.activeTestSetId }, include: { subtasks: { orderBy: { ordinal: 'asc' }, include: { tests: { include: { test: true } } } } } })
      : null;
    const ts = await prisma.$transaction(
      async (tx) => {
        const ts = await tx.testSet.create({ data: { problemId: p.id, note: file.filename } });
        await tx.test.createMany({ data: tests.map((x, i) => ({ testSetId: ts.id, ordinal: i, ...x })) });
        const created = await tx.test.findMany({ where: { testSetId: ts.id } });
        const byName = new Map(created.map((x) => [x.name, x.id]));
        // Keep the previous subtask layout where test names still exist, else one default subtask.
        let layout = (prev?.subtasks ?? []).map((s) => ({
          name: s.name,
          pointsCenti: s.pointsCenti,
          scoring: s.scoring,
          testIds: s.tests.map((x) => byName.get(x.test.name)).filter((x): x is string => !!x),
        }));
        if (layout.length === 0 || layout.some((s) => s.testIds.length === 0)) {
          const nonSample = created.filter((x) => !x.isSample);
          layout = [{ name: 'All tests', pointsCenti: 10000, scoring: 'SUM', testIds: (nonSample.length ? nonSample : created).map((x) => x.id) }];
          if (prev?.subtasks.length) warnings.push('Previous subtasks did not match the new test names; reset to one subtask with all tests');
        }
        for (const [i, s] of layout.entries()) {
          await tx.subtask.create({
            data: { testSetId: ts.id, ordinal: i + 1, name: s.name, pointsCenti: s.pointsCenti, scoring: s.scoring, tests: { create: s.testIds.map((testId) => ({ testId })) } },
          });
        }
        await tx.problem.update({ where: { id: p.id }, data: { activeTestSetId: ts.id } });
        return ts;
      },
      { timeout: 60_000 },
    );
    let rejudged = 0;
    if (req.query.rejudge === '1') {
      const subs = await prisma.submission.findMany({ where: { problemId: p.id }, select: { id: true } });
      for (const s of subs) await judgeSubmission(s.id, PRIORITY_REJUDGE);
      rejudged = subs.length;
    }
    invalidateScoreboard(p.contestId);
    await audit(req.user!.id, 'tests_upload', { problemId: p.id, tests: tests.length, rejudged });
    return { testSetId: ts.id, tests: tests.length, samples: tests.filter((x) => x.isSample).length, warnings, rejudged };
  });

  app.post<{ Params: { pid: string; tsid: string } }>('/api/admin/problems/:pid/test-sets/:tsid/activate', async (req) => {
    const ts = await prisma.testSet.findFirst({ where: { id: req.params.tsid, problemId: req.params.pid } });
    if (!ts) throw new HttpError(404, 'Test set not found');
    const p = await prisma.problem.update({ where: { id: req.params.pid }, data: { activeTestSetId: ts.id } });
    invalidateScoreboard(p.contestId);
    return { ok: true };
  });

  app.put<{ Params: { pid: string } }>('/api/admin/problems/:pid/subtasks', async (req) => {
    const body = SubtasksBody.parse(req.body);
    const p = await prisma.problem.findUniqueOrThrow({ where: { id: req.params.pid } });
    if (!p.activeTestSetId) throw new HttpError(409, 'Upload tests first');
    const tests = await prisma.test.findMany({ where: { testSetId: p.activeTestSetId } });
    const byName = new Map(tests.map((t) => [t.name, t.id]));
    const rows = body.subtasks.map((s, i) => {
      const pointsCenti = parseScore(s.points, p.scorePrecision);
      if (pointsCenti === null) {
        throw new HttpError(400, `Subtask ${i + 1}: "${s.points}" is not a valid score with ${p.scorePrecision} decimal(s)`);
      }
      const testIds = [...new Set(s.tests)].map((name) => {
        const id = byName.get(name);
        if (!id) throw new HttpError(400, `Subtask ${i + 1}: unknown test "${name}"`);
        return id;
      });
      return { ...s, pointsCenti, testIds };
    });
    await prisma.$transaction(async (tx) => {
      await tx.subtask.deleteMany({ where: { testSetId: p.activeTestSetId! } });
      for (const [i, s] of rows.entries()) {
        await tx.subtask.create({
          data: {
            testSetId: p.activeTestSetId!,
            ordinal: i + 1,
            name: s.name,
            pointsCenti: s.pointsCenti,
            scoring: s.scoring,
            tests: { create: s.testIds.map((testId) => ({ testId })) },
          },
        });
      }
    });
    const rescored = await rescoreTestSet(p.activeTestSetId);
    await audit(req.user!.id, 'subtasks_update', { problemId: p.id, subtasks: rows.length, rescored });
    return { ok: true, rescored };
  });

  const fileField = (field: 'checkerSha' | 'interactorSha' | 'statementSha' | 'attachmentSha', maxBytes: number) =>
    async (req: { params: { pid: string } } & Parameters<typeof requireAdmin>[0]) => {
      const file = await singleFile(req);
      const { sha } = await saveUpload(file, maxBytes);
      const data: Record<string, unknown> = { [field]: sha };
      if (field === 'checkerSha') data.checkerKind = 'CUSTOM';
      if (field === 'statementSha') data.statementType = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.filename) ? 'application/pdf' : file.mimetype;
      const p = await prisma.problem.update({ where: { id: req.params.pid }, data });
      await audit(req.user!.id, `problem_upload_${field}`, { problemId: p.id, sha });
      return { ok: true, sha };
    };
  app.post<{ Params: { pid: string } }>('/api/admin/problems/:pid/checker', fileField('checkerSha', 2 * 1024 * 1024));
  app.post<{ Params: { pid: string } }>('/api/admin/problems/:pid/interactor', fileField('interactorSha', 2 * 1024 * 1024));
  app.post<{ Params: { pid: string } }>('/api/admin/problems/:pid/statement', fileField('statementSha', 50 * 1024 * 1024));
  app.post<{ Params: { pid: string } }>('/api/admin/problems/:pid/attachments', fileField('attachmentSha', 200 * 1024 * 1024));
  app.delete<{ Params: { pid: string; kind: string } }>('/api/admin/problems/:pid/files/:kind', async (req) => {
    const map: Record<string, object> = {
      checker: { checkerSha: null, checkerKind: 'TOKENS' },
      interactor: { interactorSha: null },
      statement: { statementSha: null, statementType: null },
      attachments: { attachmentSha: null },
    };
    const data = map[req.params.kind];
    if (!data) throw new HttpError(404, 'Unknown file kind');
    await prisma.problem.update({ where: { id: req.params.pid }, data });
    return { ok: true };
  });

  app.get<{ Params: { pid: string; kind: string } }>('/api/admin/problems/:pid/files/:kind', async (req, reply) => {
    const p = await prisma.problem.findUniqueOrThrow({ where: { id: req.params.pid } });
    const sha = { checker: p.checkerSha, interactor: p.interactorSha, statement: p.statementSha, attachments: p.attachmentSha }[req.params.kind];
    if (!sha) throw new HttpError(404, 'No such file');
    reply.type(req.params.kind === 'statement' ? (p.statementType ?? 'application/pdf') : req.params.kind === 'attachments' ? 'application/zip' : 'text/plain; charset=utf-8');
    return reply.send(readBlob(sha));
  });

  app.get<{ Params: { tid: string; kind: 'in' | 'out' } }>('/api/admin/tests/:tid/:kind', async (req, reply) => {
    const t = await prisma.test.findUniqueOrThrow({ where: { id: req.params.tid } });
    const sha = req.params.kind === 'in' ? t.inputSha : t.answerSha;
    if (!sha) throw new HttpError(404, 'No such file');
    reply.type('text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${t.name}.${req.params.kind}"`);
    return reply.send(readBlob(sha));
  });

  /* ---------------- Submissions & rejudge ---------------- */
  app.get<{ Querystring: { contestId?: string; problemId?: string; userId?: string; status?: string; take?: string; skip?: string } }>(
    '/api/admin/submissions',
    async (req) => {
      const q = req.query;
      const where = {
        ...(q.contestId ? { contestId: q.contestId } : {}),
        ...(q.problemId ? { problemId: q.problemId } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.status ? { judgements: { some: { active: true, OR: statusOrVerdict([q.status]) } } } : {}),
      };
      const take = Math.min(Number(q.take ?? 100) || 100, 500);
      const skip = Number(q.skip ?? 0) || 0;
      const [total, subs] = await Promise.all([
        prisma.submission.count({ where }),
        prisma.submission.findMany({
          where,
          orderBy: { submittedAt: 'desc' },
          take,
          skip,
          include: {
            problem: { select: { code: true, title: true, scorePrecision: true } },
            user: { select: { username: true, displayName: true } },
            judgements: { where: { active: true } },
          },
        }),
      ]);
      return { total, items: subs.map(listItem) };
    },
  );

  app.get<{ Params: { sid: string } }>('/api/admin/submissions/:sid', async (req) => submissionDetail(req.params.sid, req.user!));

  app.post<{ Params: { sid: string } }>('/api/admin/submissions/:sid/rejudge', async (req) => {
    await judgeSubmission(req.params.sid, PRIORITY_REJUDGE);
    await audit(req.user!.id, 'rejudge', { submissionId: req.params.sid });
    return { ok: true };
  });

  app.post('/api/admin/rejudge', async (req) => {
    const body = z
      .object({ contestId: z.string(), problemId: z.string().optional(), userId: z.string().optional(), onlyStatus: z.array(z.string()).optional() })
      .parse(req.body);
    const subs = await prisma.submission.findMany({
      where: {
        contestId: body.contestId,
        ...(body.problemId ? { problemId: body.problemId } : {}),
        ...(body.userId ? { userId: body.userId } : {}),
        ...(body.onlyStatus?.length ? { judgements: { some: { active: true, OR: statusOrVerdict(body.onlyStatus) } } } : {}),
      },
      orderBy: { submittedAt: 'asc' },
      select: { id: true },
    });
    for (const s of subs) await judgeSubmission(s.id, PRIORITY_REJUDGE);
    await audit(req.user!.id, 'rejudge_bulk', { ...body, count: subs.length });
    return { count: subs.length };
  });

  /* ---------------- Queue monitor ---------------- */
  app.get('/api/admin/queue', async () => {
    const [counts, workers, active, waiting, failed] = await Promise.all([
      judgeQueue.getJobCounts('waiting', 'prioritized', 'active', 'delayed', 'failed', 'completed'),
      judgeQueue.getWorkers(),
      judgeQueue.getActive(0, 100),
      judgeQueue.getJobs(['waiting', 'prioritized'], 0, 100, true),
      judgeQueue.getFailed(0, 20),
    ]);
    const ids = [...active, ...waiting].map((j) => j.id!).filter(Boolean);
    const js = await prisma.judgement.findMany({
      where: { id: { in: ids } },
      include: { submission: { include: { user: { select: { username: true } }, problem: { select: { code: true } } } } },
    });
    const byId = new Map(js.map((j) => [j.id, j]));
    const describe = (jobId: string | undefined) => {
      const j = jobId ? byId.get(jobId) : undefined;
      return j
        ? { judgementId: j.id, submissionId: j.submissionId, username: j.submission.user.username, problem: j.submission.problem.code, status: j.status, progressDone: j.progressDone, progressTotal: j.progressTotal, createdAt: j.createdAt }
        : { judgementId: jobId };
    };
    const recentErrors = await prisma.judgement.findMany({
      where: { status: 'SE', active: true },
      orderBy: { finishedAt: 'desc' },
      take: 20,
      include: { submission: { include: { user: { select: { username: true } }, problem: { select: { code: true } } } } },
    });
    return {
      counts: { ...counts, waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0) },
      workers: workers.map((w) => ({ name: w.name, addr: w.addr, age: Number(w.age), idle: Number(w.idle) })),
      active: active.map((j) => ({ ...describe(j.id), worker: j.processedBy ?? null, startedAt: j.processedOn ?? null })),
      waiting: waiting.map((j) => describe(j.id)),
      failedJobs: failed.map((j) => ({ id: j.id, reason: j.failedReason, at: j.finishedOn })),
      recentErrors: recentErrors.map((j) => ({ judgementId: j.id, submissionId: j.submissionId, username: j.submission.user.username, problem: j.submission.problem.code, error: j.error, at: j.finishedAt })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/admin/contests/:id/reveal', async (req) => {
    const contest = await prisma.contest.findUnique({ where: { id: req.params.id } });
    if (!contest) throw new HttpError(404, 'Contest not found');
    return { contest: { id: contest.id, name: contest.name, scoringMode: contest.scoringMode, freezeAt: contest.freezeAt }, ...(await getRevealBoards(contest.id)) };
  });

  /* ---------------- Results export & audit ---------------- */
  app.get<{ Params: { id: string } }>('/api/admin/contests/:id/results.csv', async (req, reply) => {
    const board = await getScoreboard(req.params.id, true);
    const header = ['rank', 'username', 'name', 'members', 'organization', 'region', ...board.problems.map((p) => p.code)];
    header.push(...(board.mode === 'IOI' ? ['total'] : ['solved', 'penalty']));
    const maxPrec = Math.max(0, ...board.problems.map((p) => p.scorePrecision));
    const lines = [header.join(',')];
    for (const r of board.rows) {
      const cells = board.problems.map((p) => {
        if (board.mode === 'IOI') return formatScore(r.ioi![p.id].scoreCenti, p.scorePrecision);
        const c = r.icpc![p.id];
        return c.solved ? `+${c.rejected || ''} (${c.solveMinute})` : c.rejected ? `-${c.rejected}` : '';
      });
      const tail = board.mode === 'IOI' ? [formatScore(r.totalCenti!, maxPrec)] : [String(r.solved), String(r.penalty)];
      lines.push([r.rank, r.username, r.displayName, r.members, r.organization, r.region, ...cells, ...tail].map(csvEscape).join(','));
    }
    reply.type('text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="results-${req.params.id}.csv"`);
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  });

  app.get('/api/admin/audit', async () => prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }));
}

/** Filter values may be a judgement status (QUEUED, DONE, …) or a verdict (WA, TLE, …). */
function statusOrVerdict(values: string[]): Prisma.JudgementWhereInput[] {
  const statuses = values.filter((v): v is JudgementStatus => v in JudgementStatus);
  return [{ verdict: { in: values } }, ...(statuses.length ? [{ status: { in: statuses } }] : [])];
}
