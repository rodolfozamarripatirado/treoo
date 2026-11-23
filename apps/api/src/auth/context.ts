import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { appUser, authSession, membership } from '../db/schema.js';
import { HttpError, forbidden } from '../lib/errors.js';

export const COOKIE_NAME = 'treoo_sid';
export type Role = 'admin' | 'teacher' | 'student';

export interface AuthState {
  tokenHash: string;
  userId: string;
  email: string;
  displayName: string;
  academyId: string | null;
  role: Role | null;
}

/** Context every domain handler works with. Derived from the server session only. */
export interface Ctx {
  userId: string;
  academyId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthState | null;
  }
}

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function loadAuth(db: Db, token: string | undefined): Promise<AuthState | null> {
  if (!token || token.length > 100) return null;
  const tokenHash = hashToken(token);
  const rows = await db
    .select({
      tokenHash: authSession.tokenHash,
      userId: appUser.id,
      email: appUser.email,
      displayName: appUser.displayName,
      academyId: authSession.academyId,
      role: membership.role,
    })
    .from(authSession)
    .innerJoin(appUser, eq(appUser.id, authSession.userId))
    .leftJoin(membership, and(eq(membership.userId, authSession.userId), eq(membership.academyId, authSession.academyId)))
    .where(and(eq(authSession.tokenHash, tokenHash), gt(authSession.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Membership revoked since login: keep the identity but drop academy scope.
  if (row.academyId && !row.role) return { ...row, academyId: null, role: null };
  return row as AuthState;
}

/** Returns the authorised context or throws 401/403. */
export function ctx(req: FastifyRequest, ...roles: Role[]): Ctx {
  const a = req.auth;
  if (!a) throw new HttpError(401, 'unauthenticated', 'Please sign in to continue.');
  if (!a.academyId || !a.role) throw forbidden('Select an academy to continue.');
  if (roles.length && !roles.includes(a.role)) throw forbidden();
  return { userId: a.userId, academyId: a.academyId, role: a.role };
}

export function setSessionCookie(reply: FastifyReply, token: string, maxAgeSec: number, secure: boolean) {
  reply.setCookie(COOKIE_NAME, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: maxAgeSec });
}
