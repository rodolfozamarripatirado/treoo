import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx, type Ctx } from '../auth/context.js';
import type { Db } from '../db/client.js';
import { activity, appUser, curriculumTopic, exercise, lesson, material, vocabItem } from '../db/schema.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { idempotent, readKey } from '../lib/idempotency.js';
import { optText, parse, reqText, uuidParam } from '../lib/validate.js';
import { ExerciseBody, normaliseExercise } from './exercises.js';

/**
 * DEC-A-002: only the title is required; zero or more activities; activity fields optional;
 * duration optional, finite and > 0 (fractions allowed). Saving never publishes.
 */
const Duration = z.union([z.number(), z.null()]).optional().transform((v, ctx2) => {
  if (v === undefined || v === null) return null;
  if (!Number.isFinite(v) || v <= 0 || v > 600) {
    ctx2.addIssue({ code: z.ZodIssueCode.custom, message: 'Duration must be a positive number of minutes (fractions allowed).' });
    return z.NEVER;
  }
  return v;
});

const ActivityBody = z.object({
  kind: optText(60),
  title: optText(200),
  instructions: optText(5000),
  durationMinutes: Duration,
});

const LessonFields = z.object({
  title: reqText(200, 'Title'),
  topic: optText(200),
  level: optText(40),
  objective: optText(2000),
  methodology: optText(2000),
  notes: optText(5000),
  status: z.enum(['draft', 'ready']).default('draft'),
  materialId: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  curriculumTopicId: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  activities: z.array(ActivityBody).max(50, 'A lesson can have up to 50 activities.').default([]),
});

const CreateBody = LessonFields.extend({
  aiOrigin: z.enum(['mock', 'ollama']).nullable().optional().transform((v) => v ?? null),
  exercises: z.array(ExerciseBody).max(20).default([]),
});
const SaveBody = LessonFields.extend({ expectedRevision: z.number().int().positive() });

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function loadLesson(db: Db | Tx, academyId: string, id: string) {
  const [l] = await db.select({ l: lesson, ownerName: appUser.displayName }).from(lesson)
    .innerJoin(appUser, eq(appUser.id, lesson.ownerId))
    .where(and(eq(lesson.id, id), eq(lesson.academyId, academyId)));
  if (!l) return null;
  const acts = await db.select().from(activity).where(and(eq(activity.lessonId, id), eq(activity.academyId, academyId))).orderBy(asc(activity.position));
  const known = acts.filter((a) => a.durationMinutes != null);
  return {
    ...l.l,
    ownerName: l.ownerName,
    activities: acts.map(({ academyId: _a, lessonId: _l, ...a }) => a),
    totalMinutes: known.reduce((s, a) => s + (a.durationMinutes ?? 0), 0),
    activitiesWithoutDuration: acts.length - known.length,
  };
}
export type LessonView = NonNullable<Awaited<ReturnType<typeof loadLesson>>>;

/** Teachers see their own lessons; admins (academic direction) can review every lesson of the academy. */
export async function readableLesson(db: Db, c: Ctx, id: string): Promise<LessonView> {
  const l = await loadLesson(db, c.academyId, id);
  if (!l || c.role === 'student') throw notFound('Lesson');
  if (c.role === 'teacher' && l.ownerId !== c.userId) throw notFound('Lesson');
  return l;
}

async function checkMaterial(tx: Db | Tx, c: Ctx, materialId: string | null) {
  if (!materialId) return;
  const [m] = await tx.select({ id: material.id }).from(material).where(and(eq(material.id, materialId), eq(material.academyId, c.academyId), eq(material.ownerId, c.userId)));
  if (!m) throw badRequest('You can only link your own material to a lesson.');
}

async function checkTopic(tx: Db | Tx, c: Ctx, topicId: string | null) {
  if (!topicId) return;
  const [t] = await tx.select({ id: curriculumTopic.id }).from(curriculumTopic).where(and(eq(curriculumTopic.id, topicId), eq(curriculumTopic.academyId, c.academyId)));
  if (!t) throw badRequest('That curriculum topic does not exist in this academy.');
}

async function writeActivities(tx: Tx, academyId: string, lessonId: string, acts: z.infer<typeof ActivityBody>[]) {
  await tx.delete(activity).where(and(eq(activity.lessonId, lessonId), eq(activity.academyId, academyId)));
  if (acts.length) await tx.insert(activity).values(acts.map((a, i) => ({ ...a, academyId, lessonId, position: i })));
}

export const lessonRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  app.get('/', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { q, status } = parse(z.object({ q: z.string().max(100).optional(), status: z.enum(['draft', 'ready']).optional() }), req.query);
    const term = q?.trim() ? `%${q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
    return db.select({
      id: lesson.id, title: lesson.title, topic: lesson.topic, level: lesson.level, status: lesson.status,
      revision: lesson.revision, updatedAt: lesson.updatedAt, ownerId: lesson.ownerId, ownerName: appUser.displayName, aiOrigin: lesson.aiOrigin,
      activityCount: sql<number>`(select count(*)::int from treoo.activity a where a.lesson_id = ${lesson.id})`,
    }).from(lesson).innerJoin(appUser, eq(appUser.id, lesson.ownerId))
      .where(and(
        eq(lesson.academyId, c.academyId),
        c.role === 'teacher' ? eq(lesson.ownerId, c.userId) : undefined,
        status ? eq(lesson.status, status) : undefined,
        term ? or(ilike(lesson.title, term), ilike(lesson.topic, term)) : undefined,
      ))
      .orderBy(desc(lesson.updatedAt)).limit(200);
  });

  app.get('/:id', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { id } = parse(uuidParam, req.params);
    const l = await readableLesson(db, c, id);
    const exs = await db.select({ e: exercise, attempts: sql<number>`(select count(*)::int from treoo.attempt t join treoo.assignment a on a.id = t.assignment_id where a.exercise_id = "exercise"."id")` })
      .from(exercise).where(and(eq(exercise.lessonId, id), eq(exercise.academyId, c.academyId))).orderBy(asc(exercise.createdAt))
      .then((r) => r.map((x) => ({ ...x.e, attempts: x.attempts })));
    const vocab = await db.select({ id: vocabItem.id, term: vocabItem.term, partOfSpeech: vocabItem.partOfSpeech, meaning: vocabItem.meaning, example: vocabItem.example })
      .from(vocabItem).where(and(eq(vocabItem.lessonId, id), eq(vocabItem.academyId, c.academyId))).orderBy(asc(vocabItem.position));
    return { ...l, exercises: exs, vocab, canEdit: l.ownerId === c.userId };
  });

  app.post('/', async (req, reply) => {
    const c = ctx(req, 'teacher', 'admin');
    const key = readKey(req.headers['idempotency-key']);
    const body = parse(CreateBody, req.body);
    const r = await idempotent(db, c, key, 'create_lesson', body, async (tx) => {
      await checkMaterial(tx, c, body.materialId);
      await checkTopic(tx, c, body.curriculumTopicId);
      const { activities: acts, exercises: exs, ...fields } = body;
      const [l] = await tx.insert(lesson).values({ ...fields, academyId: c.academyId, ownerId: c.userId }).returning();
      await writeActivities(tx, c.academyId, l!.id, acts);
      if (exs.length) await tx.insert(exercise).values(exs.map((e) => ({ ...normaliseExercise(e), academyId: c.academyId, ownerId: c.userId, lessonId: l!.id, topic: e.topic ?? fields.topic })));
      return { status: 201, body: await loadLesson(tx, c.academyId, l!.id) };
    });
    reply.header('idempotent-replayed', String(r.replayed));
    return reply.status(r.status).send(r.body);
  });

  /** Full save with optimistic concurrency: never silently overwrites a newer revision. */
  app.put('/:id', async (req, reply) => {
    const c = ctx(req, 'teacher', 'admin');
    const { id } = parse(uuidParam, req.params);
    const key = readKey(req.headers['idempotency-key']);
    const body = parse(SaveBody, req.body);
    const r = await idempotent(db, c, key, 'save_lesson', { id, ...body }, async (tx) => {
      await checkMaterial(tx, c, body.materialId);
      await checkTopic(tx, c, body.curriculumTopicId);
      const { activities: acts, expectedRevision, ...fields } = body;
      const [u] = await tx.update(lesson)
        .set({ ...fields, revision: sql`${lesson.revision} + 1`, updatedAt: new Date() })
        .where(and(eq(lesson.id, id), eq(lesson.academyId, c.academyId), eq(lesson.ownerId, c.userId), eq(lesson.revision, expectedRevision)))
        .returning({ id: lesson.id });
      if (!u) {
        const current = await loadLesson(tx, c.academyId, id);
        if (!current || (c.role === 'teacher' && current.ownerId !== c.userId)) throw notFound('Lesson');
        if (current.ownerId !== c.userId) throw forbidden('Only the teacher who owns this lesson can edit it.');
        throw conflict('This lesson was changed somewhere else since you opened it. Your edits were not saved.', { current });
      }
      await writeActivities(tx, c.academyId, id, acts);
      return { status: 200, body: await loadLesson(tx, c.academyId, id) };
    });
    reply.header('idempotent-replayed', String(r.replayed));
    return reply.status(r.status).send(r.body);
  });

  /** Reuse: copies activities, exercises and vocabulary into a new draft owned by the caller. Nothing is published. */
  app.post('/:id/duplicate', async (req, reply) => {
    const c = ctx(req, 'teacher', 'admin');
    const { id } = parse(uuidParam, req.params);
    const src = await readableLesson(db, c, id);
    const copy = await db.transaction(async (tx) => {
      const [l] = await tx.insert(lesson).values({
        academyId: c.academyId, ownerId: c.userId, title: `${src.title} (copy)`.slice(0, 200), topic: src.topic, level: src.level,
        objective: src.objective, methodology: src.methodology, notes: src.notes, status: 'draft', aiOrigin: src.aiOrigin, curriculumTopicId: src.curriculumTopicId,
        // A material belongs to its uploader; only keep the link when copying your own lesson.
        materialId: src.ownerId === c.userId ? src.materialId : null,
      }).returning();
      await writeActivities(tx, c.academyId, l!.id, src.activities.map((a) => ({ kind: a.kind, title: a.title, instructions: a.instructions, durationMinutes: a.durationMinutes })));
      const exs = await tx.select().from(exercise).where(and(eq(exercise.lessonId, id), eq(exercise.academyId, c.academyId)));
      if (exs.length) await tx.insert(exercise).values(exs.map(({ id: _i, createdAt: _c, lessonId: _l, ownerId: _o, ...e }) => ({ ...e, ownerId: c.userId, lessonId: l!.id })));
      const words = await tx.select().from(vocabItem).where(and(eq(vocabItem.lessonId, id), eq(vocabItem.academyId, c.academyId)));
      if (words.length) await tx.insert(vocabItem).values(words.map(({ id: _i, createdAt: _c, lessonId: _l, ...w }) => ({ ...w, lessonId: l!.id })));
      return l!;
    });
    return reply.status(201).send({ id: copy.id });
  });

  app.delete('/:id', async (req) => {
    const c = ctx(req, 'teacher', 'admin');
    const { id } = parse(uuidParam, req.params);
    const l = await loadLesson(db, c.academyId, id);
    if (!l || (c.role === 'teacher' && l.ownerId !== c.userId)) throw notFound('Lesson');
    if (l.ownerId !== c.userId) throw forbidden('Only the owner can delete this lesson.');
    await db.delete(lesson).where(and(eq(lesson.id, id), eq(lesson.academyId, c.academyId)));
    return { ok: true };
  });
};
