import { Queue, Worker, type Job } from 'bullmq';
import { QUEUE_JUDGE, QUEUE_RESULTS, type JudgeJob, type JudgeProgress, type JudgeResult } from '@noi/shared';
import path from 'node:path';
import { config } from './config.js';
import { HttpFileCache } from './files.js';
import { judge, makeSlot } from './judge.js';
import { writeIsolateConfig } from './setup.js';

function redisConnection() {
  const u = new URL(config.redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password ? decodeURIComponent(u.password) : undefined,
    maxRetriesPerRequest: null,
  };
}

async function main() {
  if (!config.workerToken) throw new Error('WORKER_TOKEN is required');
  await writeIsolateConfig();
  const files = new HttpFileCache(path.join(config.cacheDir, 'files'), config.apiInternalUrl, config.workerToken);
  const connection = redisConnection();
  const results = new Queue<JudgeResult>(QUEUE_RESULTS, { connection });
  const freeSlots = Array.from({ length: config.slots }, (_, i) => makeSlot(i));

  const worker = new Worker<JudgeJob, JudgeResult>(
    QUEUE_JUDGE,
    async (job: Job<JudgeJob>) => {
      const slot = freeSlots.pop();
      if (!slot) throw new Error('No free grading slot');
      try {
        const t0 = Date.now();
        const result = await judge(job.data, slot, files, (p: JudgeProgress) => job.updateProgress(p as never));
        const attempts = job.opts.attempts ?? 1;
        if (result.status === 'SE' && job.attemptsMade + 1 < attempts) {
          // Let BullMQ retry; a transient infrastructure error must not reach the contestant.
          throw new Error(`System error (will retry): ${result.error}`);
        }
        await results.add('result', result, { removeOnComplete: 1000, removeOnFail: 5000, attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
        console.log(`[${config.workerName}] judgement ${job.data.judgementId}: ${result.status} in ${Date.now() - t0} ms`);
        return result;
      } finally {
        freeSlots.push(slot);
      }
    },
    { connection, concurrency: config.slots, name: config.workerName, lockDuration: 60_000 },
  );
  worker.on('failed', (job, err) => console.error(`[${config.workerName}] job ${job?.id} failed: ${err.message}`));
  worker.on('error', (err) => console.error(`[${config.workerName}] worker error: ${err.message}`));
  console.log(`[${config.workerName}] grading worker ready: ${config.slots} slot(s), cgroups=${config.useCgroups}`);

  const shutdown = async () => {
    console.log('Shutting down: finishing current jobs...');
    await worker.close();
    await results.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
