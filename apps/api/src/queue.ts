import { Queue } from 'bullmq';
import { QUEUE_JUDGE, type JudgeJob } from '@noi/shared';
import { config } from './config.js';

export function redisConnection() {
  const u = new URL(config.redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password ? decodeURIComponent(u.password) : undefined,
    maxRetriesPerRequest: null,
  };
}

export const connection = redisConnection();
export const judgeQueue = new Queue<JudgeJob>(QUEUE_JUDGE, { connection });

/** Live submissions jump ahead of rejudges. */
export const PRIORITY_LIVE = 1;
export const PRIORITY_REJUDGE = 10;
