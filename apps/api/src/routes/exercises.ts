import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx } from '../auth/context.js';
import { appUser, assignment, attempt, classSession, exercise, lesson } from '../db/schema.js';
import { getManagedGroup } from '../lib/access.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { isoDate, optText, parse, reqText, uuidParam } from '../lib/validate.js';

export const ExerciseBody = z.object({
  type: z.enum(['single_choice', 'true_false', 'short_answer']),
  prompt: reqText(1000, 'Question'),
  options: z.array(z.string().trim().max(300)).max(6).nullable().optional(),
  correctAnswer: z.union([z.number().int(), z.boolean(), z.string().max(1000), z.null()]).optional(),
  topic: optText(200),
  points: z.number().int().min(1).max(100).default(1),
}).superRefine((e, c) => {
  if (e.type === 'single_choice') {
    const opts = (e.options ?? []).filter(Boolean);
    if (opts.length < 2) c.addIssue({ code: 'custom', path: ['options'], message: 'Add at least two answer options.' });
    if (typeof e.correctAnswer !== 'number' || e.correctAnswer < 0 || e.correctAnswer >= opts.length) c.addIssue({ code: 'custom', path: ['correctAnswer'], message: 'Mark which option is correct.' });
  }
  if (e.type === 'true_false' && typeof e.correctAnswer !== 'boolean') c.addIssue({ code: 'custom', path: ['correctAnswer'], message: 'Choose True or False as the correct answer.' });
});
export type ExerciseInput = z.infer<typeof ExerciseBody>;

export function normaliseExercise(e: ExerciseInput) {
  return {
    type: e.type,
    prompt: e.prompt,
    points: e.points,
    topic: e.topic,
    options: e.type === 'single_choice' ? (e.options ?? []).filter(Boolean) : null,
    correctAnswer: e.type === 'short_answer' ? (typeof e.correctAnswer === 'string' && e.correctAnswer.trim() ? e.correctAnswer.trim() : null) : (e.correctAnswer ?? null),
  };
}

/** Auto-scores closed questions; open answers wait for the teacher (the teacher keeps control of evaluation). */
export function autoScore(ex: { type: string; correctAnswer: unknown; points: number }, answer: unknown): number | null {
  if (ex.type === 'single_choice' || ex.type === 'true_false') return answer === ex.correctAnswer ? ex.points : 0;
  return null;
}

export const exerciseRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  const ownExercise = async (academyId: string, userId: string, id: string) => {
    const [e] = await db.select().from(exercise).where(and(eq(exercise.id, id), eq(exercise.academyId, academyId)));
    if (!e) throw notFound('Exercise');
    if (e.ownerId !== userId) throw forbidden('Only the teacher who wrote this exercise can change it.');
    return e;
  };

  app.get('/exercises', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { lessonId } = parse(z.object({ lessonId: z.string().uuid().optional() }), req.query);
    return db.select().from(exercise).where(and(
      eq(exercise.academyId, c.academyId),
      lessonId ? eq(exercise.lessonId, lessonId) : undefined,
      c.role === 'teacher' ? eq(exercise.ownerId, c.userId) : undefined,
    )).orderBy(asc(exercise.createdAt));
  });

  app.post('/exercises', async (req, reply) => {
    const c = ctx(req, 'teacher', 'admin');
    const body = parse(ExerciseBody.and(z.object({ lessonId: z.string().uuid().nullable().optional() })), req.body);
    if (body.lessonId) {
      const [l] = await db.select().from(lesson).where(and(eq(lesson.id, body.lessonId), eq(lesson.academyId, c.academyId)));
      if (!l || l.ownerId !== c.userId) throw badRequest('You can only add exercises to your own lessons.');
    }
    const [e] = await db.insert(exercise).values({ ...normaliseExercise(body), academyId: c.academyId, ownerId: c.userId, lessonId: body.lessonId ?? null }).returning();
    return reply.status(201).send(e);
  });

  app.put('/exercises/:id', async (req) => {
    const c = ctx(req, 'teacher', 'admin');
    const { id } = parse(uuidParam, req.params);
    await ownExercise(c.academyId, c.userId, id);
    const body = parse(ExerciseBody, req.body);
    const [e] = await db.update(exercise).set(normaliseExercise(body)).where(and(eq(exercise.id, id), eq(exercise.academyId, c.academyId))).returning();
    return e;
  });

  app.delete('/exercises/:id', async (req) => {
    const c = ctx(req, 'teacher', 'admin');
    const { id } = parse(uuidParam, req.params);
    await ownExercise(c.academyId, c.userId, id);
    await db.delete(exercise).where(and(eq(exercise.id, id), eq(exercise.academyId, c.academyId)));
    return { ok: true };
  });

  // ---------- Assignments & review ----------

  app.post('/assignments', async (req, reply) => {
    const c = ctx(req, 'teacher', 'admin');
    const body = parse(z.object({ groupId: z.string().uuid(), exerciseIds: z.array(z.string().uuid()).min(1).max(20), sessionId: z.string().uuid().nullable().optional(), dueOn: isoDate.nullable().optional() }), req.body);
    await getManagedGroup(db, c, body.groupId);
    if (body.sessionId) {
      const [s] = await db.select().from(classSession).where(and(eq(classSession.id, body.sessionId), eq(classSession.academyId, c.academyId), eq(classSession.groupId, body.groupId)));
      if (!s) throw badRequest('The class session does not belong to this group.');
    }
    const exs = await db.select({ id: exercise.id }).from(exercise).where(and(eq(exercise.academyId, c.academyId), sql`${exercise.id} = any(${body.exerciseIds}::uuid[])`));
    if (exs.length !== new Set(body.exerciseIds).size) throw badRequest('Some exercises do not exist in this academy.');
    const rows = await db.insert(assignment).values(exs.map((e) => ({ academyId: c.academyId, groupId: body.groupId, exerciseId: e.id, sessionId: body.sessionId ?? null, dueOn: body.dueOn ?? null }))).returning();
    return reply.status(201).send(rows);
  });

  app.get('/assignments', async (req) => {
    const c = ctx(req, 'teacher', 'admin');
    const { groupId } = parse(z.object({ groupId: z.string().uuid() }), req.query);
    await getManagedGroup(db, c, groupId);
    return db.select({
      id: assignment.id, dueOn: assignment.dueOn, createdAt: assignment.createdAt, sessionId: assignment.sessionId,
      exerciseId: exercise.id, prompt: exercise.prompt, type: exercise.type, topic: exercise.topic, points: exercise.points,
      submitted: sql<number>`(select count(distinct a.student_id)::int from treoo.attempt a where a.assignment_id = ${assignment.id})`,
      pendingReview: sql<number>`(select count(*)::int from treoo.attempt a where a.assignment_id = ${assignment.id} and a.auto_score is null and a.teacher_score is null)`,
    }).from(assignment).innerJoin(exercise, eq(exercise.id, assignment.exerciseId))
      .where(and(eq(assignment.academyId, c.academyId), eq(assignment.groupId, groupId))).orderBy(desc(assignment.createdAt));
  });

  app.get('/assignments/:id/attempts', async (req) => {
    const c = ctx(req, 'teacher', 'admin');
    const { id } = parse(uuidParam, req.params);
    const [a] = await db.select().from(assignment).where(and(eq(assignment.id, id), eq(assignment.academyId, c.academyId)));
    if (!a) throw notFound('Assignment');
    await getManagedGroup(db, c, a.groupId);
    const [ex] = await db.select().from(exercise).where(eq(exercise.id, a.exerciseId));
    const attempts = await db.select({ a: attempt, studentName: appUser.displayName }).from(attempt)
      .innerJoin(appUser, eq(appUser.id, attempt.studentId))
      .where(and(eq(attempt.assignmentId, id), eq(attempt.academyId, c.academyId))).orderBy(asc(appUser.displayName), desc(attempt.createdAt));
    return { assignment: a, exercise: ex, attempts: attempts.map((r) => ({ ...r.a, studentName: r.studentName })) };
  });

  app.put('/attempts/:id/review', async (req) => {
    const c = ctx(req, 'teacher', 'admin');
    const { id } = parse(uuidParam, req.params);
    const [row] = await db.select({ at: attempt, as: assignment, ex: exercise }).from(attempt)
      .innerJoin(assignment, eq(assignment.id, attempt.assignmentId)).innerJoin(exercise, eq(exercise.id, assignment.exerciseId))
      .where(and(eq(attempt.id, id), eq(attempt.academyId, c.academyId)));
    if (!row) throw notFound('Attempt');
    await getManagedGroup(db, c, row.as.groupId);
    const body = parse(z.object({ teacherScore: z.number().min(0).max(row.ex.points).nullable(), feedback: optText(3000) }), req.body);
    const [u] = await db.update(attempt).set({ teacherScore: body.teacherScore, feedback: body.feedback, reviewedAt: new Date() })
      .where(and(eq(attempt.id, id), eq(attempt.academyId, c.academyId))).returning();
    return u;
  });
};
