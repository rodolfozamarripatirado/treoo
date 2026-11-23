import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx } from '../auth/context.js';
import { assignment, calendarEvent, classSession, enrollment, eventSignup, exercise, site, studentGoal, studentGroup } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { isoDate, optText, parse, reqText, uuidParam } from '../lib/validate.js';
import { maskPrompt } from './exercises.js';

const EventBody = z.object({
  kind: z.enum(['holiday', 'event', 'exam']), title: reqText(200, 'Title'), description: optText(2000),
  startsOn: isoDate, endsOn: isoDate, siteId: z.string().uuid().nullable().optional(),
  capacity: z.number().int().positive().max(10000).nullable().optional(), signupOpen: z.boolean().default(false),
}).refine((e) => e.endsOn >= e.startsOn, { path: ['endsOn'], message: 'The end date must be on or after the start date.' });

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  const eventsBetween = (academyId: string, from: string, to: string) => db.select({
    id: calendarEvent.id, kind: calendarEvent.kind, title: calendarEvent.title, description: calendarEvent.description,
    startsOn: calendarEvent.startsOn, endsOn: calendarEvent.endsOn, siteId: calendarEvent.siteId, siteName: site.name,
    capacity: calendarEvent.capacity, signupOpen: calendarEvent.signupOpen,
    signups: sql<number>`(select count(*)::int from treoo.event_signup s where s.event_id = ${calendarEvent.id})`,
  }).from(calendarEvent).leftJoin(site, eq(site.id, calendarEvent.siteId))
    .where(and(eq(calendarEvent.academyId, academyId), lte(calendarEvent.startsOn, to), gte(calendarEvent.endsOn, from))).orderBy(asc(calendarEvent.startsOn));

  const Range = z.object({ from: isoDate, to: isoDate });

  /** Staff calendar: academy events plus classes of the groups the caller teaches (all groups for admins). */
  app.get('/calendar', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { from, to } = parse(Range, req.query);
    const classes = await db.select({ id: classSession.id, scheduledOn: classSession.scheduledOn, startTime: classSession.startTime, endTime: classSession.endTime, topic: classSession.topic, groupName: studentGroup.name, status: classSession.status })
      .from(classSession).innerJoin(studentGroup, eq(studentGroup.id, classSession.groupId))
      .where(and(eq(classSession.academyId, c.academyId), gte(classSession.scheduledOn, from), lte(classSession.scheduledOn, to), c.role === 'teacher' ? eq(studentGroup.teacherId, c.userId) : undefined))
      .orderBy(asc(classSession.scheduledOn));
    return { events: await eventsBetween(c.academyId, from, to), classes };
  });

  app.post('/events', async (req, reply) => {
    const c = ctx(req, 'admin');
    const b = parse(EventBody, req.body);
    if (b.siteId) { const [s] = await db.select().from(site).where(and(eq(site.id, b.siteId), eq(site.academyId, c.academyId))); if (!s) throw badRequest('Unknown site.'); }
    const [e] = await db.insert(calendarEvent).values({ ...b, siteId: b.siteId ?? null, capacity: b.capacity ?? null, academyId: c.academyId }).returning();
    return reply.status(201).send(e);
  });
  app.delete('/events/:id', async (req) => {
    const c = ctx(req, 'admin');
    const { id } = parse(uuidParam, req.params);
    await db.delete(calendarEvent).where(and(eq(calendarEvent.id, id), eq(calendarEvent.academyId, c.academyId)));
    return { ok: true };
  });
  app.get('/events/:id/signups', async (req) => {
    const c = ctx(req, 'admin');
    const { id } = parse(uuidParam, req.params);
    const r = await db.execute(sql`select u.display_name as "displayName", u.email, s.created_at as "createdAt" from treoo.event_signup s
      join treoo.app_user u on u.id = s.student_id where s.event_id = ${id} and s.academy_id = ${c.academyId} order by s.created_at`);
    return r.rows;
  });

  // ---------- Student ----------
  const myGroups = (academyId: string, userId: string) => db.select({ g: enrollment.groupId }).from(enrollment).where(and(eq(enrollment.academyId, academyId), eq(enrollment.studentId, userId)));

  app.get('/portal/calendar', async (req) => {
    const c = ctx(req, 'student');
    const { from, to } = parse(Range, req.query);
    const classes = await db.select({ id: classSession.id, scheduledOn: classSession.scheduledOn, startTime: classSession.startTime, endTime: classSession.endTime, status: classSession.status, cancelledReason: classSession.cancelledReason, topic: classSession.topic, groupName: studentGroup.name, published: sql<boolean>`${classSession.publishedAt} is not null` })
      .from(classSession).innerJoin(studentGroup, eq(studentGroup.id, classSession.groupId))
      .where(and(eq(classSession.academyId, c.academyId), inArray(classSession.groupId, myGroups(c.academyId, c.userId)), gte(classSession.scheduledOn, from), lte(classSession.scheduledOn, to)));
    const due = (await db.select({ id: assignment.id, dueOn: assignment.dueOn, dueTime: assignment.dueTime, prompt: exercise.prompt, type: exercise.type }).from(assignment).innerJoin(exercise, eq(exercise.id, assignment.exerciseId))
      .where(and(eq(assignment.academyId, c.academyId), inArray(assignment.groupId, myGroups(c.academyId, c.userId)), gte(assignment.dueOn, from), lte(assignment.dueOn, to))))
      .map(({ type, ...t }) => ({ ...t, prompt: type === 'gap_fill' ? maskPrompt(t.prompt) : t.prompt }));
    const mySites = db.select({ s: studentGroup.siteId }).from(studentGroup).where(inArray(studentGroup.id, myGroups(c.academyId, c.userId)));
    const events = await eventsBetween(c.academyId, from, to);
    const visibleSites = new Set((await mySites).map((r) => r.s));
    const mine = await db.select({ e: eventSignup.eventId }).from(eventSignup).where(and(eq(eventSignup.studentId, c.userId), eq(eventSignup.academyId, c.academyId)));
    const signed = new Set(mine.map((m) => m.e));
    return {
      classes, due,
      events: events.filter((e) => !e.siteId || visibleSites.has(e.siteId)).map((e) => ({ ...e, signedUp: signed.has(e.id) })),
    };
  });

  app.post('/portal/events/:id/signup', async (req, reply) => {
    const c = ctx(req, 'student');
    const { id } = parse(uuidParam, req.params);
    await db.transaction(async (tx) => {
      const [e] = await tx.select().from(calendarEvent).where(and(eq(calendarEvent.id, id), eq(calendarEvent.academyId, c.academyId))).for('update');
      if (!e || !e.signupOpen) throw notFound('Event');
      if (e.endsOn < new Date().toISOString().slice(0, 10)) throw badRequest('This event has already finished.');
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(eventSignup).where(eq(eventSignup.eventId, id))) as [{ n: number }];
      if (e.capacity && n >= e.capacity) throw conflict('This event is full.');
      await tx.insert(eventSignup).values({ academyId: c.academyId, eventId: id, studentId: c.userId }).onConflictDoNothing();
    });
    return reply.status(201).send({ ok: true });
  });
  app.delete('/portal/events/:id/signup', async (req) => {
    const c = ctx(req, 'student');
    const { id } = parse(uuidParam, req.params);
    await db.delete(eventSignup).where(and(eq(eventSignup.eventId, id), eq(eventSignup.studentId, c.userId), eq(eventSignup.academyId, c.academyId)));
    return { ok: true };
  });

  // ---------- Student goals (REQ-051) ----------
  app.get('/portal/goals', async (req) => {
    const c = ctx(req, 'student');
    return db.select().from(studentGoal).where(and(eq(studentGoal.academyId, c.academyId), eq(studentGoal.studentId, c.userId))).orderBy(asc(studentGoal.doneAt), asc(studentGoal.targetDate));
  });
  app.post('/portal/goals', async (req, reply) => {
    const c = ctx(req, 'student');
    const b = parse(z.object({ text: reqText(300, 'Goal'), targetDate: isoDate.nullable().optional() }), req.body);
    const [g] = await db.insert(studentGoal).values({ ...b, targetDate: b.targetDate ?? null, academyId: c.academyId, studentId: c.userId }).returning();
    return reply.status(201).send(g);
  });
  app.put('/portal/goals/:id', async (req) => {
    const c = ctx(req, 'student');
    const { id } = parse(uuidParam, req.params);
    const { done } = parse(z.object({ done: z.boolean() }), req.body);
    const [g] = await db.update(studentGoal).set({ doneAt: done ? new Date() : null }).where(and(eq(studentGoal.id, id), eq(studentGoal.studentId, c.userId), eq(studentGoal.academyId, c.academyId))).returning();
    if (!g) throw notFound('Goal');
    return g;
  });
  app.delete('/portal/goals/:id', async (req) => {
    const c = ctx(req, 'student');
    const { id } = parse(uuidParam, req.params);
    await db.delete(studentGoal).where(and(eq(studentGoal.id, id), eq(studentGoal.studentId, c.userId), eq(studentGoal.academyId, c.academyId)));
    return { ok: true };
  });
};
