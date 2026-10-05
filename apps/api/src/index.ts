import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ensureAdmin, registerAuth } from './auth.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { buildJob, startJudgingConsumers } from './judging.js';
import { judgeQueue, PRIORITY_REJUDGE } from './queue.js';
import { adminRoutes } from './routes/admin.js';
import { contestantRoutes } from './routes/contestant.js';
import { internalRoutes } from './routes/internal.js';
import { initStorage, TooLargeError } from './storage.js';
import { HttpError } from './util.js';

export async function buildApp() {
  const app = Fastify({ logger: { level: config.logLevel }, bodyLimit: 8 * 1024 * 1024, trustProxy: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxZipBytes, files: 500, fields: 20, fieldSize: config.maxSourceBytes } });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const i = err.issues[0];
      return reply.status(400).send({ error: `${i.path.join('.') || 'input'}: ${i.message}` });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    if (err instanceof TooLargeError) return reply.status(413).send({ error: err.message });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return reply.status(409).send({ error: `Already exists (${String(err.meta?.target ?? 'unique field')})` });
      if (err.code === 'P2025') return reply.status(404).send({ error: 'Not found' });
    }
    const e = err as { statusCode?: number; message: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Internal server error' });
  });

  await registerAuth(app);
  app.get('/api/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    await judgeQueue.getJobCounts('waiting');
    return { ok: true, time: new Date().toISOString() };
  });
  await app.register(internalRoutes);
  await app.register(contestantRoutes);
  await app.register(adminRoutes);
  return app;
}

/** Re-queues judgements left unfinished if Redis lost its data (e.g. volume reset). */
async function recoverQueue(log: { info: (m: string) => void }) {
  const pending = await prisma.judgement.findMany({
    where: { active: true, status: { in: ['QUEUED', 'COMPILING', 'RUNNING'] } },
    select: { id: true },
  });
  let n = 0;
  for (const { id } of pending) {
    if (await judgeQueue.getJob(id)) continue;
    await judgeQueue.add('judge', await buildJob(id), { jobId: id, priority: PRIORITY_REJUDGE, attempts: 2, removeOnComplete: 2000, removeOnFail: 5000 });
    n++;
  }
  if (n) log.info(`Re-queued ${n} unfinished judgement(s)`);
}

async function main() {
  if (!config.workerToken) throw new Error('WORKER_TOKEN is required');
  await initStorage();
  const app = await buildApp();
  await ensureAdmin(app.log);
  const stopConsumers = startJudgingConsumers(app.log);
  await recoverQueue(app.log);
  await app.listen({ port: config.port, host: config.host });
  const shutdown = async () => {
    await app.close();
    await stopConsumers();
    await judgeQueue.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
