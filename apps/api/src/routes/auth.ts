import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { COOKIE_NAME, hashToken, newToken, setSessionCookie } from '../auth/context.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { academy, appUser, authSession, membership } from '../db/schema.js';
import { HttpError, forbidden } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

// Real dummy hash so unknown emails cost the same as a wrong password (no account enumeration by timing).
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword('treoo-dummy-password'));

export const authRoutes: FastifyPluginAsync = async (app) => {
  const { db, env } = app.svc;
  const secure = (proto: string) => env.COOKIE_SECURE === 'auto' ? proto === 'https' : env.COOKIE_SECURE === 'true';

  const memberships = (userId: string) => db
    .select({ academyId: membership.academyId, academyName: academy.name, role: membership.role })
    .from(membership).innerJoin(academy, eq(academy.id, membership.academyId))
    .where(eq(membership.userId, userId)).orderBy(academy.name);

  app.post('/login', { config: { rateLimit: {
    max: env.LOGIN_RATE_LIMIT, timeWindow: '1 minute',
    keyGenerator: (req) => `${req.ip}:${String((req.body as { email?: unknown } | undefined)?.email ?? '').toLowerCase().slice(0, 200)}`,
  } } }, async (req, reply) => {
    const body = parse(z.object({ email: z.string().trim().min(1, 'Enter your email.').max(200), password: z.string().min(1, 'Enter your password.').max(200) }), req.body);
    const [user] = await db.select().from(appUser).where(sql`lower(${appUser.email}) = lower(${body.email})`).limit(1);
    const ok = await verifyPassword(user?.passwordHash ?? await getDummyHash(), body.password);
    if (!user || !ok) throw new HttpError(401, 'invalid_credentials', 'That email and password combination is not correct.');
    const list = await memberships(user.id);
    // Reopen the academy used most recently, if the person is still a member there.
    const [last] = await db.select({ academyId: authSession.academyId }).from(authSession)
      .where(and(eq(authSession.userId, user.id), sql`${authSession.academyId} is not null`)).orderBy(desc(authSession.createdAt)).limit(1);
    const start = list.find((m) => m.academyId === last?.academyId) ?? list[0];
    const token = newToken();
    const ttl = env.SESSION_TTL_HOURS * 3600;
    await db.insert(authSession).values({ tokenHash: hashToken(token), userId: user.id, academyId: start?.academyId ?? null, expiresAt: new Date(Date.now() + ttl * 1000) });
    setSessionCookie(reply, token, ttl, secure(req.protocol));
    return { ok: true };
  });

  app.post('/logout', async (req, reply) => {
    if (req.auth) await db.delete(authSession).where(eq(authSession.tokenHash, req.auth.tokenHash));
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const a = req.auth;
    if (!a) throw new HttpError(401, 'unauthenticated', 'Please sign in to continue.');
    return {
      user: { id: a.userId, email: a.email, displayName: a.displayName },
      active: a.academyId ? { academyId: a.academyId, role: a.role } : null,
      memberships: await memberships(a.userId),
    };
  });

  app.post('/academy', async (req) => {
    const a = req.auth;
    if (!a) throw new HttpError(401, 'unauthenticated', 'Please sign in to continue.');
    const { academyId } = parse(z.object({ academyId: z.string().uuid() }), req.body);
    const [m] = await db.select().from(membership).where(and(eq(membership.userId, a.userId), eq(membership.academyId, academyId)));
    if (!m) throw forbidden('You are not a member of that academy.');
    await db.update(authSession).set({ academyId }).where(eq(authSession.tokenHash, a.tokenHash));
    return { ok: true };
  });
};
