function int(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

export const config = {
  port: int('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
  workerToken: process.env.WORKER_TOKEN ?? '',
  dataDir: process.env.DATA_DIR ?? '/data',
  sessionHours: int('SESSION_HOURS', 24),
  /** Set to 1 when served over HTTPS (cloud mode) so cookies are marked Secure. */
  cookieSecure: process.env.COOKIE_SECURE === '1',
  /** Contestant accounts may only be logged in on one computer at a time. */
  singleSession: process.env.SINGLE_SESSION !== '0',
  adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  /** Max submissions per contestant per minute (anti-flood). */
  submitPerMinute: int('SUBMIT_PER_MINUTE', 6),
  /** Max login attempts per IP address per minute (slows password guessing). */
  loginPerMinute: int('LOGIN_PER_MINUTE', 100),
  maxSourceBytes: int('MAX_SOURCE_KB', 256) * 1024,
  maxOutputBytes: int('MAX_OUTPUT_MB', 64) * 1024 * 1024,
  maxZipBytes: int('MAX_ZIP_MB', 1024) * 1024 * 1024,
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
