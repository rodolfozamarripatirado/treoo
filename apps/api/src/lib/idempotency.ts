import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Ctx } from '../auth/context.js';
import type { Db } from '../db/client.js';
import { mutationDedup } from '../db/schema.js';
import { HttpError } from './errors.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export const requestHash = (kind: string, payload: unknown) => createHash('sha256').update(`${kind}\n${canonicalJson(payload)}`).digest('hex');

export function readKey(header: unknown): string | null {
  if (header === undefined) return null;
  if (typeof header !== 'string' || !/^[A-Za-z0-9_.:-]{8,200}$/.test(header)) throw new HttpError(400, 'bad_idempotency_key', 'Invalid Idempotency-Key header.');
  return header;
}

/**
 * Runs a mutation at most once per (academy, user, key). A retry with the same key and the same
 * normalised request replays the stored response; the same key with a different request is rejected.
 */
export async function idempotent<T>(
  db: Db, c: Ctx, key: string | null, kind: string, payload: unknown,
  run: (tx: Tx) => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T; replayed: boolean }> {
  if (!key) return { ...(await db.transaction(run)), replayed: false };
  const hash = requestHash(kind, payload);
  const lookup = async () => {
    const [row] = await db.select().from(mutationDedup).where(and(eq(mutationDedup.academyId, c.academyId), eq(mutationDedup.userId, c.userId), eq(mutationDedup.operationKey, key)));
    if (!row) return null;
    if (row.operationKind !== kind || row.requestHash !== hash) throw new HttpError(422, 'idempotency_key_reused', 'This request key was already used for a different change. Reload and try again.');
    return { status: row.statusCode, body: row.response as T, replayed: true };
  };
  const prior = await lookup();
  if (prior) return prior;
  try {
    const out = await db.transaction(async (tx) => {
      const r = await run(tx);
      await tx.insert(mutationDedup).values({ academyId: c.academyId, userId: c.userId, operationKey: key, operationKind: kind, requestHash: hash, statusCode: r.status, response: r.body as object });
      return r;
    });
    return { ...out, replayed: false };
  } catch (e) {
    // Concurrent duplicate committed first: replay its response.
    if ((e as { code?: string }).code === '23505') { const again = await lookup(); if (again) return again; }
    throw e;
  }
}
