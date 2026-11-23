import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx } from '../auth/context.js';
import { appUser, attendance, classSession, enrollment, exercise, studentGroup } from '../db/schema.js';
import { getManagedGroup, isEnrolled } from '../lib/access.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { isoDate, optText, parse, uuidParam } from '../lib/validate.js';
import { loadLesson, readableLesson } from './lessons.js';

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  const { db, storage } = app.svc;

  const managed = async (req: Parameters<typeof ctx>[0], id: string) => {
    const c = ctx(req, 'teacher', 'admin');
    const [s] = await db.select().from(classSession).where(and(eq(classSession.id, id), eq(classSession.academyId, c.academyId)));
    if (!s) throw notFound('Class');
    await getManagedGroup(db, c, s.groupId);
    return { c, s };
  };

  app.get('/', async (req) => {
    const c = ctx(req, 'teacher', 'admin');
    const q = parse(z.object({ groupId: z.string().uuid().optional(), from: isoDate.optional(), to: isoDate.optional() }), req.query);
    return db.select({
      id: classSession.id, scheduledOn: classSession.scheduledOn, topic: classSession.topic, status: classSession.status,
      publishedAt: classSession.publishedAt, groupId: studentGroup.id, groupName: studentGroup.name, lessonId: classSession.lessonId,
    }).from(classSession).innerJoin(studentGroup, eq(studentGroup.id, classSession.groupId))
      .where(and(
        eq(classSession.academyId, c.academyId),
        c.role === 'teacher' ? eq(studentGroup.teacherId, c.userId) : undefined,
        q.groupId ? eq(classSession.groupId, q.groupId) : undefined,
        q.from ? gte(classSession.scheduledOn, q.from) : undefined,
        q.to ? lte(classSession.scheduledOn, q.to) : undefined,
      )).orderBy(desc(classSession.scheduledOn)).limit(300);
  });

  app.post('/', async (req, reply) => {
    const c = ctx(req, 'teacher', 'admin');
    const body = parse(z.object({ groupId: z.string().uuid(), lessonId: z.string().uuid().nullable().optional(), scheduledOn: isoDate, topic: optText(200) }), req.body);
    const g = await getManagedGroup(db, c, body.groupId);
    let topic = body.topic;
    if (body.lessonId) {
      const l = await readableLesson(db, c, body.lessonId);
      topic ??= l.topic ?? l.title;
    }
    const [s] = await db.insert(classSession).values({ academyId: c.academyId, groupId: g.id, lessonId: body.lessonId ?? null, teacherId: g.teacherId ?? c.userId, scheduledOn: body.scheduledOn, topic }).returning();
    return reply.status(201).send(s);
  });

  app.get('/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { c, s } = await managed(req, id);
    const [group] = await db.select().from(studentGroup).where(eq(studentGroup.id, s.groupId));
    const roster = await db.select({ id: appUser.id, displayName: appUser.displayName, status: attendance.status })
      .from(enrollment).innerJoin(appUser, eq(appUser.id, enrollment.studentId))
      .leftJoin(attendance, and(eq(attendance.sessionId, id), eq(attendance.studentId, enrollment.studentId)))
      .where(and(eq(enrollment.groupId, s.groupId), eq(enrollment.academyId, c.academyId))).orderBy(asc(appUser.displayName));
    const lessonView = s.lessonId ? await loadLesson(db, c.academyId, s.lessonId) : null;
    const exs = s.lessonId ? await db.select().from(exercise).where(and(eq(exercise.lessonId, s.lessonId), eq(exercise.academyId, c.academyId))) : [];
    const { boardKey, ...rest } = s;
    return { ...rest, hasBoard: !!boardKey, group, lesson: lessonView, roster, exercises: exs };
  });

  app.put('/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { c } = await managed(req, id);
    const body = parse(z.object({ scheduledOn: isoDate, topic: optText(200), lessonId: z.string().uuid().nullable().optional() }), req.body);
    if (body.lessonId) await readableLesson(db, c, body.lessonId);
    const [u] = await db.update(classSession).set({ scheduledOn: body.scheduledOn, topic: body.topic, lessonId: body.lessonId ?? null }).where(and(eq(classSession.id, id), eq(classSession.academyId, c.academyId))).returning();
    return u;
  });

  app.put('/:id/attendance', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { c, s } = await managed(req, id);
    const { records } = parse(z.object({ records: z.array(z.object({ studentId: z.string().uuid(), status: z.enum(['present', 'absent', 'late', 'excused']) })).max(200) }), req.body);
    const enrolled = records.length ? await db.select({ id: enrollment.studentId }).from(enrollment)
      .where(and(eq(enrollment.groupId, s.groupId), inArray(enrollment.studentId, records.map((r) => r.studentId)))) : [];
    if (enrolled.length !== new Set(records.map((r) => r.studentId)).size) throw badRequest('Attendance can only be taken for students in this group.');
    await db.transaction(async (tx) => {
      for (const r of records) {
        await tx.insert(attendance).values({ academyId: c.academyId, sessionId: id, studentId: r.studentId, status: r.status })
          .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: { status: r.status } });
      }
    });
    return { ok: true };
  });

  /** Records what actually happened in class. Private notes never reach students. */
  app.post('/:id/deliver', { bodyLimit: 8 * 1024 * 1024 }, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { c, s } = await managed(req, id);
    const body = parse(z.object({ sharedNotes: optText(20_000), privateNotes: optText(20_000), board: z.string().max(7_500_000).nullable().optional(), shareBoard: z.boolean().default(false), shareMaterial: z.boolean().optional() }), req.body);
    let boardKey = s.boardKey;
    if (body.board) {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.board);
      if (!m) throw badRequest('The board image must be a PNG.');
      const buf = Buffer.from(m[1]!, 'base64');
      if (buf.subarray(0, 4).toString('hex') !== '89504e47') throw badRequest('The board image must be a PNG.');
      boardKey = await storage.save(c.academyId, buf, 'png');
    }
    const [u] = await db.update(classSession).set({
      sharedNotes: body.sharedNotes, privateNotes: body.privateNotes, boardKey, shareBoard: body.shareBoard ? 1 : 0,
      ...(body.shareMaterial === undefined ? {} : { shareMaterial: body.shareMaterial ? 1 : 0 }),
      status: 'delivered', deliveredAt: s.deliveredAt ?? new Date(),
    }).where(and(eq(classSession.id, id), eq(classSession.academyId, c.academyId))).returning();
    const { boardKey: _k, ...rest } = u!;
    return { ...rest, hasBoard: !!boardKey };
  });

  app.post('/:id/publish', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { c } = await managed(req, id);
    const [u] = await db.update(classSession).set({ publishedAt: new Date() }).where(and(eq(classSession.id, id), eq(classSession.academyId, c.academyId))).returning({ publishedAt: classSession.publishedAt });
    return u;
  });

  app.post('/:id/unpublish', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { c } = await managed(req, id);
    await db.update(classSession).set({ publishedAt: null }).where(and(eq(classSession.id, id), eq(classSession.academyId, c.academyId)));
    return { publishedAt: null };
  });

  app.delete('/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { c } = await managed(req, id);
    await db.delete(classSession).where(and(eq(classSession.id, id), eq(classSession.academyId, c.academyId)));
    return { ok: true };
  });

  /** Board image: staff of the group, or enrolled students once published and shared. */
  app.get('/:id/board', async (req, reply) => {
    const c = ctx(req);
    const { id } = parse(uuidParam, req.params);
    const [s] = await db.select().from(classSession).where(and(eq(classSession.id, id), eq(classSession.academyId, c.academyId)));
    if (!s || !s.boardKey) throw notFound('Board');
    if (c.role === 'student') {
      if (!s.publishedAt || !s.shareBoard || !(await isEnrolled(db, c, s.groupId))) throw notFound('Board');
    } else {
      await getManagedGroup(db, c, s.groupId).catch(() => { throw new HttpError(404, 'not_found', 'Board not found.'); });
    }
    reply.header('content-type', 'image/png').header('cache-control', 'private, max-age=60');
    return reply.send(storage.stream(s.boardKey));
  });
};
