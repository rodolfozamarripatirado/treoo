import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx } from '../auth/context.js';
import { appUser, enrollment, studentGroup } from '../db/schema.js';
import { getGroup, getManagedGroup, memberRole } from '../lib/access.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { optText, parse, reqText, uuidParam } from '../lib/validate.js';

const GroupBody = z.object({
  name: reqText(120, 'Group name'),
  level: optText(40),
  schedule: optText(200),
  teacherId: z.string().uuid().nullable().optional(),
});

export const groupRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  app.get('/', async (req) => {
    const c = ctx(req);
    const base = db.select({
      id: studentGroup.id, name: studentGroup.name, level: studentGroup.level, schedule: studentGroup.schedule,
      teacherId: studentGroup.teacherId, teacherName: appUser.displayName,
      studentCount: sql<number>`(select count(*)::int from treoo.enrollment e where e.group_id = ${studentGroup.id})`,
    }).from(studentGroup).leftJoin(appUser, eq(appUser.id, studentGroup.teacherId));
    if (c.role === 'student') {
      const mine = db.select({ g: enrollment.groupId }).from(enrollment).where(and(eq(enrollment.academyId, c.academyId), eq(enrollment.studentId, c.userId)));
      return base.where(and(eq(studentGroup.academyId, c.academyId), inArray(studentGroup.id, mine))).orderBy(asc(studentGroup.name));
    }
    return base.where(eq(studentGroup.academyId, c.academyId)).orderBy(asc(studentGroup.name));
  });

  const checkTeacher = async (academyId: string, teacherId: string | null | undefined) => {
    if (!teacherId) return;
    const role = await memberRole(db, academyId, teacherId);
    if (role !== 'teacher' && role !== 'admin') throw badRequest('The selected teacher is not a teacher in this academy.');
  };

  app.post('/', async (req, reply) => {
    const c = ctx(req, 'admin');
    const body = parse(GroupBody, req.body);
    await checkTeacher(c.academyId, body.teacherId);
    const [g] = await db.insert(studentGroup).values({ ...body, teacherId: body.teacherId ?? null, academyId: c.academyId }).returning();
    return reply.status(201).send(g);
  });

  app.put('/:id', async (req) => {
    const c = ctx(req, 'admin');
    const { id } = parse(uuidParam, req.params);
    await getGroup(db, c, id);
    const body = parse(GroupBody, req.body);
    await checkTeacher(c.academyId, body.teacherId);
    const [g] = await db.update(studentGroup).set({ ...body, teacherId: body.teacherId ?? null }).where(and(eq(studentGroup.id, id), eq(studentGroup.academyId, c.academyId))).returning();
    return g;
  });

  app.get('/:id', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { id } = parse(uuidParam, req.params);
    const g = await getGroup(db, c, id);
    const students = await db.select({ id: appUser.id, displayName: appUser.displayName, email: appUser.email })
      .from(enrollment).innerJoin(appUser, eq(appUser.id, enrollment.studentId))
      .where(and(eq(enrollment.groupId, id), eq(enrollment.academyId, c.academyId))).orderBy(asc(appUser.displayName));
    return { ...g, students, canManage: c.role === 'admin' || g.teacherId === c.userId };
  });

  app.post('/:id/students', async (req, reply) => {
    const c = ctx(req, 'admin');
    const { id } = parse(uuidParam, req.params);
    await getGroup(db, c, id);
    const { studentId } = parse(z.object({ studentId: z.string().uuid() }), req.body);
    if (await memberRole(db, c.academyId, studentId) !== 'student') throw badRequest('That person is not a student of this academy.');
    await db.insert(enrollment).values({ academyId: c.academyId, groupId: id, studentId }).onConflictDoNothing();
    return reply.status(201).send({ ok: true });
  });

  app.delete('/:id/students/:studentId', async (req) => {
    const c = ctx(req, 'admin');
    const { id, studentId } = parse(z.object({ id: z.string().uuid(), studentId: z.string().uuid() }), req.params);
    await getManagedGroup(db, c, id).catch(() => { throw forbidden(); });
    await db.delete(enrollment).where(and(eq(enrollment.groupId, id), eq(enrollment.studentId, studentId), eq(enrollment.academyId, c.academyId)));
    return { ok: true };
  });
};
