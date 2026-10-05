import { hash, verify } from '@node-rs/argon2';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@prisma/client';
import { z } from 'zod';
import { config } from './config.js';
import { prisma } from './db.js';
import { audit, HttpError } from './util.js';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  displayName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

const COOKIE = 'noi_sid';

export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

export function generatePassword(len = 10): string {
  // No ambiguous characters (0/O, 1/l/I) so printed credentials are easy to type.
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function tokenEquals(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const sid = req.cookies[COOKIE];
    if (!sid) return;
    const session = await prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
    if (!session || session.expiresAt < new Date()) return;
    const u = session.user;
    req.user = { id: u.id, username: u.username, role: u.role, displayName: u.displayName };
  });
  // CSRF: state-changing requests must carry a custom header, which cross-site forms cannot send.
  app.addHook('preHandler', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.url.startsWith('/internal/')) return;
    if (req.headers['x-noi-csrf'] !== '1') throw new HttpError(403, 'Missing CSRF header');
  });

  const LoginBody = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) });
  app.post('/api/auth/login', { config: { rateLimit: { max: config.loginPerMinute, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username: body.username.trim() } });
    const ok = user ? await verify(user.passwordHash, body.password) : false;
    if (!user || !ok) {
      await audit(null, 'login_failed', { username: body.username, ip: req.ip });
      throw new HttpError(401, 'Invalid username or password');
    }
    if (user.role === 'CONTESTANT' && config.singleSession) {
      await prisma.session.deleteMany({ where: { userId: user.id } });
    }
    const id = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.sessionHours * 3600_000);
    await prisma.session.create({ data: { id, userId: user.id, expiresAt } });
    await audit(user.id, 'login', { ip: req.ip });
    reply.setCookie(COOKIE, id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      expires: expiresAt,
    });
    return { id: user.id, username: user.username, role: user.role, displayName: user.displayName };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const sid = req.cookies[COOKIE];
    if (sid) await prisma.session.deleteMany({ where: { id: sid } });
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: req.user, serverTime: new Date().toISOString() }));

  const PwBody = z.object({ current: z.string(), next: z.string().min(8).max(200) });
  app.post('/api/auth/password', async (req) => {
    const u = requireUser(req);
    const body = PwBody.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    if (!(await verify(user.passwordHash, body.current))) throw new HttpError(400, 'Current password is wrong');
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(body.next) } });
    return { ok: true };
  });
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, 'Please log in');
  return req.user;
}

export function requireAdmin(req: FastifyRequest): AuthUser {
  const u = requireUser(req);
  if (u.role !== 'ADMIN') throw new HttpError(403, 'Admins only');
  return u;
}

export async function adminOnly(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  requireAdmin(req);
}

export async function ensureAdmin(log: FastifyInstance['log']): Promise<void> {
  const count = await prisma.user.count({ where: { role: 'ADMIN' } });
  if (count > 0) return;
  if (!config.adminPassword) {
    log.warn('No admin account exists and ADMIN_PASSWORD is not set; set it in .env and restart.');
    return;
  }
  await prisma.user.create({
    data: {
      username: config.adminUsername,
      passwordHash: await hashPassword(config.adminPassword),
      role: 'ADMIN',
      displayName: 'Administrator',
    },
  });
  log.info(`Created admin account "${config.adminUsername}"`);
}
