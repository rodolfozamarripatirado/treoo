import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx, type Ctx } from '../auth/context.js';
import type { Db } from '../db/client.js';
import { activity, assignment, attempt, attendance, classSession, enrollment, exercise, lesson, studentGroup, vocabItem } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse, uuidParam } from '../lib/validate.js';
import { autoScore } from './exercises.js';

const MAX_ATTEMPTS = 3;

const myGroups = (db: Db, c: Ctx) =>
  db.select({ g: enrollment.groupId }).from(enrollment).where(and(eq(enrollment.academyId, c.academyId), eq(enrollment.studentId, c.userId)));

/** Student-facing views: only published content of the student's own groups; never private notes or other students' data. */
export const portalRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  const publishedSessions = async (c: Ctx, sessionId?: string) => {
    const rows = await db.select({
      id: classSession.id, scheduledOn: classSession.scheduledOn, topic: classSession.topic, sharedNotes: classSession.sharedNotes,
      hasBoard: sql<boolean>`(${classSession.boardKey} is not null and ${classSession.shareBoard} = 1)`,
      publishedAt: classSession.publishedAt, groupId: studentGroup.id, groupName: studentGroup.name,
      lessonId: lesson.id, lessonTitle: lesson.title, lessonTopic: lesson.topic, objective: lesson.objective, level: lesson.level,
      myAttendance: attendance.status,
    }).from(classSession)
      .innerJoin(studentGroup, eq(studentGroup.id, classSession.groupId))
      .leftJoin(lesson, eq(lesson.id, classSession.lessonId))
      .leftJoin(attendance, and(eq(attendance.sessionId, classSession.id), eq(attendance.studentId, c.userId)))
      .where(and(
        eq(classSession.academyId, c.academyId), isNotNull(classSession.publishedAt),
        inArray(classSession.groupId, myGroups(db, c)),
        sessionId ? eq(classSession.id, sessionId) : undefined,
      )).orderBy(desc(classSession.scheduledOn));
    return rows.map((r) => ({ ...r, topic: r.topic ?? r.lessonTopic ?? r.lessonTitle ?? 'General' }));
  };

  app.get('/diary', async (req) => {
    const c = ctx(req, 'student');
    return publishedSessions(c);
  });

  app.get('/sessions/:id', async (req) => {
    const c = ctx(req, 'student');
    const { id } = parse(uuidParam, req.params);
    const [s] = await publishedSessions(c, id);
    if (!s) throw notFound('Class');
    const acts = s.lessonId ? await db.select({ title: activity.title, kind: activity.kind, instructions: activity.instructions, durationMinutes: activity.durationMinutes })
      .from(activity).where(and(eq(activity.lessonId, s.lessonId), eq(activity.academyId, c.academyId))).orderBy(asc(activity.position)) : [];
    const tasks = await db.select({ id: assignment.id, prompt: exercise.prompt, dueOn: assignment.dueOn }).from(assignment)
      .innerJoin(exercise, eq(exercise.id, assignment.exerciseId)).where(and(eq(assignment.sessionId, id), eq(assignment.academyId, c.academyId)));
    const vocab = s.lessonId ? await db.select({ id: vocabItem.id, term: vocabItem.term, partOfSpeech: vocabItem.partOfSpeech, meaning: vocabItem.meaning, example: vocabItem.example })
      .from(vocabItem).where(and(eq(vocabItem.lessonId, s.lessonId), eq(vocabItem.academyId, c.academyId))).orderBy(asc(vocabItem.position)) : [];
    return { ...s, activities: acts, assignments: tasks, vocab };
  });

  app.get('/assignments', async (req) => {
    const c = ctx(req, 'student');
    const rows = await db.select({ a: assignment, e: exercise, groupName: studentGroup.name, sessionDate: classSession.scheduledOn }).from(assignment)
      .innerJoin(exercise, eq(exercise.id, assignment.exerciseId))
      .innerJoin(studentGroup, eq(studentGroup.id, assignment.groupId))
      .leftJoin(classSession, eq(classSession.id, assignment.sessionId))
      .where(and(eq(assignment.academyId, c.academyId), inArray(assignment.groupId, myGroups(db, c))))
      .orderBy(asc(assignment.dueOn), desc(assignment.createdAt));
    const attempts = rows.length ? await db.select().from(attempt)
      .where(and(eq(attempt.academyId, c.academyId), eq(attempt.studentId, c.userId), inArray(attempt.assignmentId, rows.map((r) => r.a.id))))
      .orderBy(desc(attempt.createdAt)) : [];
    return rows.map(({ a, e, groupName, sessionDate }) => {
      const mine = attempts.filter((t) => t.assignmentId === a.id);
      return {
        id: a.id, dueOn: a.dueOn, groupName, sessionDate, sessionId: a.sessionId,
        exercise: { type: e.type, prompt: e.prompt, options: e.options, points: e.points, topic: e.topic,
          // The answer key is revealed only after the student has attempted.
          correctAnswer: mine.length ? e.correctAnswer : undefined },
        attempts: mine.map(({ academyId: _a, ...t }) => t),
        attemptsLeft: Math.max(0, MAX_ATTEMPTS - mine.length),
      };
    });
  });

  app.post('/assignments/:id/attempts', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const c = ctx(req, 'student');
    const { id } = parse(uuidParam, req.params);
    const [row] = await db.select({ a: assignment, e: exercise }).from(assignment).innerJoin(exercise, eq(exercise.id, assignment.exerciseId))
      .where(and(eq(assignment.id, id), eq(assignment.academyId, c.academyId), inArray(assignment.groupId, myGroups(db, c))));
    if (!row) throw notFound('Assignment');
    const schema = row.e.type === 'single_choice' ? z.number().int().min(0).max((row.e.options?.length ?? 1) - 1)
      : row.e.type === 'true_false' ? z.boolean() : z.string().trim().min(1, 'Write your answer.').max(5000);
    const { answer } = parse(z.object({ answer: schema }), req.body);
    const created = await db.transaction(async (tx) => {
      // Serialise attempts per student+assignment so the limit cannot be bypassed by parallel requests.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${c.userId}:${id}`}))`);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(attempt).where(and(eq(attempt.assignmentId, id), eq(attempt.studentId, c.userId)))) as [{ n: number }];
      if (n >= MAX_ATTEMPTS) throw badRequest(`You have used all ${MAX_ATTEMPTS} attempts for this task.`);
      const [t] = await tx.insert(attempt).values({ academyId: c.academyId, assignmentId: id, studentId: c.userId, answer, autoScore: autoScore(row.e, answer) }).returning();
      return t!;
    });
    const { academyId: _a, ...t } = created;
    return reply.status(201).send({ ...t, points: row.e.points, correctAnswer: row.e.correctAnswer });
  });

  app.get('/progress', async (req) => {
    const c = ctx(req, 'student');
    const att = await db.select({ status: attendance.status, n: sql<number>`count(*)::int` }).from(attendance)
      .where(and(eq(attendance.academyId, c.academyId), eq(attendance.studentId, c.userId))).groupBy(attendance.status);
    const topics = await db.execute<{ topic: string; tasks: number; pct: number | null }>(sql`
      with latest as (
        select distinct on (t.assignment_id) t.assignment_id, coalesce(t.teacher_score, t.auto_score) as score
        from treoo.attempt t where t.academy_id = ${c.academyId} and t.student_id = ${c.userId}
        order by t.assignment_id, t.created_at desc)
      select coalesce(e.topic, 'General') as topic, count(*)::int as tasks,
             round((100 * avg(l.score / e.points))::numeric, 0)::float as pct
      from latest l join treoo.assignment a on a.id = l.assignment_id join treoo.exercise e on e.id = a.exercise_id
      group by 1 order by 1`);
    return { attendance: Object.fromEntries(att.map((a) => [a.status, a.n])), topics: topics.rows };
  });
};
