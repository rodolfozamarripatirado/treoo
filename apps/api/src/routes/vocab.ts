import { and, asc, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AiUnavailableError } from '../ai/adapter.js';
import { ctx, type Ctx } from '../auth/context.js';
import type { Db } from '../db/client.js';
import { classSession, enrollment, lesson, material, vocabItem, vocabReview } from '../db/schema.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { optText, parse, reqText, uuidParam } from '../lib/validate.js';
import { readableLesson } from './lessons.js';

/** Days until the next review for each Leitner box (box 1 → tomorrow … box 5 → in 16 days). */
export const BOX_INTERVAL = [1, 2, 4, 8, 16] as const;
const addDays = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const todayIso = () => new Date().toISOString().slice(0, 10);

const VocabBody = z.object({
  id: z.string().uuid().optional(),
  term: reqText(120, 'Word or phrase'),
  partOfSpeech: optText(40),
  meaning: optText(400),
  example: optText(400),
});

export const vocabularyFor = (db: Db, academyId: string, lessonId: string) =>
  db.select({ id: vocabItem.id, term: vocabItem.term, partOfSpeech: vocabItem.partOfSpeech, meaning: vocabItem.meaning, example: vocabItem.example })
    .from(vocabItem).where(and(eq(vocabItem.academyId, academyId), eq(vocabItem.lessonId, lessonId))).orderBy(asc(vocabItem.position));

/** Lessons whose content the student may see: linked to a published class of one of their groups. */
const publishedLessonIds = (db: Db, c: Ctx) =>
  db.select({ id: classSession.lessonId }).from(classSession).where(and(
    eq(classSession.academyId, c.academyId), isNotNull(classSession.publishedAt), isNotNull(classSession.lessonId),
    inArray(classSession.groupId, db.select({ g: enrollment.groupId }).from(enrollment).where(and(eq(enrollment.academyId, c.academyId), eq(enrollment.studentId, c.userId)))),
  ));

export const vocabRoutes: FastifyPluginAsync = async (app) => {
  const { db, ai } = app.svc;

  // ---------- Teacher ----------
  app.get('/lessons/:id/vocab', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { id } = parse(uuidParam, req.params);
    await readableLesson(db, c, id);
    return vocabularyFor(db, c.academyId, id);
  });

  /** Saves the full list in order. Existing items keep their id so student review progress survives edits. */
  app.put('/lessons/:id/vocab', async (req) => {
    const c = ctx(req, 'teacher', 'admin');
    const { id } = parse(uuidParam, req.params);
    const l = await readableLesson(db, c, id);
    if (l.ownerId !== c.userId) throw forbidden('Only the teacher who owns this lesson can change its vocabulary.');
    const { items } = parse(z.object({ items: z.array(VocabBody).max(60, 'A lesson can have up to 60 words.') }), req.body);
    await db.transaction(async (tx) => {
      const keep = items.map((i) => i.id).filter((x): x is string => !!x);
      await tx.delete(vocabItem).where(and(eq(vocabItem.lessonId, id), eq(vocabItem.academyId, c.academyId), keep.length ? notInArray(vocabItem.id, keep) : undefined));
      // Move kept rows out of the way first so positions can be rewritten freely.
      for (const [i, item] of items.entries()) {
        const values = { term: item.term, partOfSpeech: item.partOfSpeech, meaning: item.meaning, example: item.example, position: i };
        if (item.id) {
          const u = await tx.update(vocabItem).set(values).where(and(eq(vocabItem.id, item.id), eq(vocabItem.lessonId, id), eq(vocabItem.academyId, c.academyId))).returning({ id: vocabItem.id });
          if (!u.length) throw badRequest('One of the words does not belong to this lesson. Reload and try again.');
        } else {
          await tx.insert(vocabItem).values({ ...values, academyId: c.academyId, lessonId: id });
        }
      }
    });
    return vocabularyFor(db, c.academyId, id);
  });

  /** Unsaved suggestions from the lesson's material (or given text). The teacher picks what to keep. */
  app.post('/ai/vocab', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const c = ctx(req, 'teacher', 'admin');
    const body = parse(z.object({ lessonId: z.string().uuid().optional(), sourceText: optText(50_000), level: optText(40) }), req.body);
    let text = body.sourceText;
    let level = body.level;
    if (!text && body.lessonId) {
      const l = await readableLesson(db, c, body.lessonId);
      level ??= l.level;
      if (l.materialId) {
        const [m] = await db.select({ t: material.extractedText }).from(material).where(and(eq(material.id, l.materialId), eq(material.academyId, c.academyId)));
        text = m?.t ?? null;
      }
      text ??= [l.title, l.objective, ...l.activities.map((a) => `${a.title ?? ''}. ${a.instructions ?? ''}`)].filter(Boolean).join('\n');
    }
    if (!text?.trim()) throw badRequest('There is no text to take vocabulary from yet.');
    try {
      return await ai.suggestVocab({ sourceText: text, level, max: 10 });
    } catch (e) {
      if (e instanceof AiUnavailableError) throw new HttpError(503, 'ai_unavailable', `${e.message} You can add words manually.`);
      throw e;
    }
  });

  // ---------- Student: Vocabulary Lab ----------
  app.get('/portal/vocab', async (req) => {
    const c = ctx(req, 'student');
    const rows = await db.select({
      id: vocabItem.id, term: vocabItem.term, partOfSpeech: vocabItem.partOfSpeech, meaning: vocabItem.meaning, example: vocabItem.example,
      lessonId: lesson.id, lessonTitle: lesson.title, topic: lesson.topic,
      box: vocabReview.box, nextDue: vocabReview.nextDue, reviews: vocabReview.reviews,
    }).from(vocabItem)
      .innerJoin(lesson, eq(lesson.id, vocabItem.lessonId))
      .leftJoin(vocabReview, and(eq(vocabReview.vocabItemId, vocabItem.id), eq(vocabReview.studentId, c.userId)))
      .where(and(eq(vocabItem.academyId, c.academyId), inArray(vocabItem.lessonId, publishedLessonIds(db, c))))
      .orderBy(asc(lesson.title), asc(vocabItem.position));
    const today = todayIso();
    return rows.map((r) => ({ ...r, box: r.box ?? 0, due: !r.nextDue || r.nextDue <= today }));
  });

  app.post('/portal/vocab/:id/review', async (req) => {
    const c = ctx(req, 'student');
    const { id } = parse(uuidParam, req.params);
    const { result } = parse(z.object({ result: z.enum(['known', 'again']) }), req.body);
    const [item] = await db.select({ id: vocabItem.id }).from(vocabItem)
      .where(and(eq(vocabItem.id, id), eq(vocabItem.academyId, c.academyId), inArray(vocabItem.lessonId, publishedLessonIds(db, c))));
    if (!item) throw notFound('Word');
    const [prev] = await db.select().from(vocabReview).where(and(eq(vocabReview.studentId, c.userId), eq(vocabReview.vocabItemId, id)));
    const box = result === 'known' ? Math.min(5, (prev?.box ?? 0) + 1) : 1;
    const nextDue = addDays(BOX_INTERVAL[box - 1]!);
    const [r] = await db.insert(vocabReview).values({ academyId: c.academyId, studentId: c.userId, vocabItemId: id, box, nextDue, reviews: 1, lapses: result === 'again' ? 1 : 0 })
      .onConflictDoUpdate({
        target: [vocabReview.studentId, vocabReview.vocabItemId],
        set: { box, nextDue, reviews: sql`${vocabReview.reviews} + 1`, lapses: result === 'again' ? sql`${vocabReview.lapses} + 1` : sql`${vocabReview.lapses}`, updatedAt: new Date() },
      }).returning();
    return { box: r!.box, nextDue: r!.nextDue };
  });
};
