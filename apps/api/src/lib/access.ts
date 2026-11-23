import { and, eq } from 'drizzle-orm';
import type { Ctx } from '../auth/context.js';
import type { Db } from '../db/client.js';
import { enrollment, membership, studentGroup } from '../db/schema.js';
import { forbidden, notFound } from './errors.js';

/** Group must belong to the caller's academy. Cross-academy ids look exactly like missing ones (404). */
export async function getGroup(db: Db, c: Ctx, groupId: string) {
  const [g] = await db.select().from(studentGroup).where(and(eq(studentGroup.id, groupId), eq(studentGroup.academyId, c.academyId)));
  if (!g) throw notFound('Group');
  return g;
}

/** Admins manage every group; teachers manage the groups assigned to them. */
export async function getManagedGroup(db: Db, c: Ctx, groupId: string) {
  const g = await getGroup(db, c, groupId);
  if (c.role === 'admin' || (c.role === 'teacher' && g.teacherId === c.userId)) return g;
  throw forbidden('Only the group teacher or an admin can do this.');
}

export async function isEnrolled(db: Db, c: Ctx, groupId: string, studentId = c.userId) {
  const [e] = await db.select().from(enrollment).where(and(eq(enrollment.academyId, c.academyId), eq(enrollment.groupId, groupId), eq(enrollment.studentId, studentId)));
  return !!e;
}

export async function memberRole(db: Db, academyId: string, userId: string) {
  const [m] = await db.select().from(membership).where(and(eq(membership.academyId, academyId), eq(membership.userId, userId)));
  return m?.role ?? null;
}
