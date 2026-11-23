import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx, type Ctx } from '../auth/context.js';
import type { Db } from '../db/client.js';
import { appUser, enrollment, studentGroup, studentNote } from '../db/schema.js';
import { forbidden, notFound } from '../lib/errors.js';
import { parse, reqText, uuidParam } from '../lib/validate.js';
import { memberRole } from '../lib/access.js';

/** Admins see every student of the academy; teachers only students in a group they teach. */
async function viewableStudent(db: Db, c: Ctx, studentId: string) {
  if (await memberRole(db, c.academyId, studentId) !== 'student') throw notFound('Student');
  if (c.role === 'admin') return;
  const [shared] = await db.select({ g: enrollment.groupId }).from(enrollment)
    .innerJoin(studentGroup, eq(studentGroup.id, enrollment.groupId))
    .where(and(eq(enrollment.academyId, c.academyId), eq(enrollment.studentId, studentId), eq(studentGroup.teacherId, c.userId))).limit(1);
  if (!shared) throw notFound('Student');
}

export const studentRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  app.get('/:id', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { id } = parse(uuidParam, req.params);
    await viewableStudent(db, c, id);
    const [user] = await db.select({ id: appUser.id, displayName: appUser.displayName, email: appUser.email }).from(appUser).where(eq(appUser.id, id));
    const groups = await db.select({ id: studentGroup.id, name: studentGroup.name, level: studentGroup.level }).from(enrollment)
      .innerJoin(studentGroup, eq(studentGroup.id, enrollment.groupId)).where(and(eq(enrollment.studentId, id), eq(enrollment.academyId, c.academyId)));
    const attendance = await db.execute(sql`
      select s.id as "sessionId", s.scheduled_on as "scheduledOn", s.topic, g.name as "groupName", a.status
      from treoo.class_session s join treoo.student_group g on g.id = s.group_id
      join treoo.enrollment en on en.group_id = g.id and en.student_id = ${id}
      left join treoo.attendance a on a.session_id = s.id and a.student_id = ${id}
      where s.academy_id = ${c.academyId} and (s.status = 'delivered' or a.status is not null)
      order by s.scheduled_on desc limit 60`);
    const topics = await db.execute(sql`
      with latest as (
        select t.*, row_number() over (partition by t.assignment_id order by t.created_at desc) as rn
        from treoo.attempt t where t.academy_id = ${c.academyId} and t.student_id = ${id})
      select coalesce(e.topic, 'General') as topic, count(*)::int as tasks,
        round(100 * avg(coalesce(l.teacher_score, l.auto_score) / e.points))::int as "avgScore",
        count(*) filter (where coalesce(l.teacher_score, l.auto_score) is null)::int as "pendingReview"
      from latest l join treoo.assignment a on a.id = l.assignment_id join treoo.exercise e on e.id = a.exercise_id
      where l.rn = 1 group by 1 order by 1`);
    const recent = await db.execute(sql`
      select t.id, t.created_at as "createdAt", e.prompt, e.type, e.options, t.answer, t.auto_score as "autoScore",
        t.teacher_score as "teacherScore", e.points, t.feedback
      from treoo.attempt t join treoo.assignment a on a.id = t.assignment_id join treoo.exercise e on e.id = a.exercise_id
      where t.academy_id = ${c.academyId} and t.student_id = ${id} order by t.created_at desc limit 15`);
    const vocab = await db.execute(sql`
      select count(*)::int as reviewed, count(*) filter (where box >= 3)::int as strong
      from treoo.vocab_review where academy_id = ${c.academyId} and student_id = ${id}`);
    const notes = await db.select({ id: studentNote.id, body: studentNote.body, createdAt: studentNote.createdAt, authorId: studentNote.authorId, authorName: appUser.displayName })
      .from(studentNote).innerJoin(appUser, eq(appUser.id, studentNote.authorId))
      .where(and(eq(studentNote.academyId, c.academyId), eq(studentNote.studentId, id))).orderBy(desc(studentNote.createdAt));
    return { student: user, groups, attendance: attendance.rows, topics: topics.rows, recent: recent.rows, vocab: vocab.rows[0], notes };
  });

  app.post('/:id/notes', async (req, reply) => {
    const c = ctx(req, 'admin', 'teacher');
    const { id } = parse(uuidParam, req.params);
    await viewableStudent(db, c, id);
    const { body } = parse(z.object({ body: reqText(3000, 'Note') }), req.body);
    const [n] = await db.insert(studentNote).values({ academyId: c.academyId, studentId: id, authorId: c.userId, body }).returning();
    return reply.status(201).send(n);
  });

  app.delete('/:id/notes/:noteId', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { id, noteId } = parse(z.object({ id: z.string().uuid(), noteId: z.string().uuid() }), req.params);
    await viewableStudent(db, c, id);
    const [n] = await db.select().from(studentNote).where(and(eq(studentNote.id, noteId), eq(studentNote.academyId, c.academyId), eq(studentNote.studentId, id)));
    if (!n) throw notFound('Note');
    if (n.authorId !== c.userId) throw forbidden('You can only delete your own notes.');
    await db.delete(studentNote).where(eq(studentNote.id, noteId));
    return { ok: true };
  });
};
