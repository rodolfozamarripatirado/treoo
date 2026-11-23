import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx } from '../auth/context.js';
import { appUser, curriculumPlan, curriculumPlanTopic, curriculumTopic, curriculumUnit } from '../db/schema.js';
import { getGroup } from '../lib/access.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { optText, parse, reqText, uuidParam } from '../lib/validate.js';

const TopicBody = z.object({ id: z.string().uuid().optional(), title: reqText(200, 'Topic'), objective: optText(1000), skill: optText(40), required: z.boolean().default(true) });
const UnitBody = z.object({ level: reqText(40, 'Level'), title: reqText(200, 'Unit title'), description: optText(1000), topics: z.array(TopicBody).max(40).default([]) });

/** Academy curriculum: levels → units → topics. Admins edit; teachers read and link lessons to topics. */
export const curriculumRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  const tree = async (academyId: string, level?: string, includeArchived = false) => {
    const units = await db.select().from(curriculumUnit).where(and(eq(curriculumUnit.academyId, academyId), level ? eq(curriculumUnit.level, level) : undefined, includeArchived ? undefined : isNull(curriculumUnit.archivedAt)))
      .orderBy(asc(curriculumUnit.level), asc(curriculumUnit.position));
    const topics = units.length ? await db.select().from(curriculumTopic).where(and(inArray(curriculumTopic.unitId, units.map((u) => u.id)), includeArchived ? undefined : isNull(curriculumTopic.archivedAt))).orderBy(asc(curriculumTopic.position)) : [];
    return units.map((u) => ({ ...u, topics: topics.filter((t) => t.unitId === u.id) }));
  };

  app.get('/', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { level, includeArchived } = parse(z.object({ level: z.string().max(40).optional(), includeArchived: z.enum(['1', 'true']).optional() }), req.query);
    return tree(c.academyId, level, !!includeArchived);
  });

  /** Topics removed from the list are archived, never deleted: lessons, coverage and published versions keep pointing at them. */
  const writeTopics = async (academyId: string, unitId: string, topics: z.infer<typeof TopicBody>[]) => {
    const keep = topics.map((t) => t.id).filter((x): x is string => !!x);
    const existing = await db.select({ id: curriculumTopic.id }).from(curriculumTopic).where(eq(curriculumTopic.unitId, unitId));
    const drop = existing.map((e) => e.id).filter((x) => !keep.includes(x));
    if (drop.length) await db.update(curriculumTopic).set({ archivedAt: new Date() }).where(and(inArray(curriculumTopic.id, drop), isNull(curriculumTopic.archivedAt)));
    for (const [i, t] of topics.entries()) {
      const v = { title: t.title, objective: t.objective, skill: t.skill, required: t.required, position: i, archivedAt: null };
      if (t.id && existing.some((e) => e.id === t.id)) await db.update(curriculumTopic).set(v).where(eq(curriculumTopic.id, t.id));
      else await db.insert(curriculumTopic).values({ ...v, academyId, unitId });
    }
  };

  app.post('/units', async (req, reply) => {
    const c = ctx(req, 'admin');
    const b = parse(UnitBody, req.body);
    const [{ n }] = (await db.select({ n: sql<number>`coalesce(max(${curriculumUnit.position}) + 1, 0)::int` }).from(curriculumUnit)
      .where(and(eq(curriculumUnit.academyId, c.academyId), eq(curriculumUnit.level, b.level), isNull(curriculumUnit.archivedAt)))) as [{ n: number }];
    const [u] = await db.insert(curriculumUnit).values({ academyId: c.academyId, level: b.level, title: b.title, description: b.description, position: n }).returning();
    await writeTopics(c.academyId, u!.id, b.topics);
    return reply.status(201).send((await tree(c.academyId, b.level)).find((x) => x.id === u!.id));
  });

  app.put('/units/:id', async (req) => {
    const c = ctx(req, 'admin');
    const { id } = parse(uuidParam, req.params);
    const b = parse(UnitBody, req.body);
    const [u] = await db.update(curriculumUnit).set({ level: b.level, title: b.title, description: b.description })
      .where(and(eq(curriculumUnit.id, id), eq(curriculumUnit.academyId, c.academyId))).returning();
    if (!u) throw notFound('Unit');
    await writeTopics(c.academyId, id, b.topics);
    return (await tree(c.academyId, b.level)).find((x) => x.id === id);
  });

  app.delete('/units/:id', async (req) => {
    const c = ctx(req, 'admin');
    const { id } = parse(uuidParam, req.params);
    const now = new Date();
    const [u] = await db.update(curriculumUnit).set({ archivedAt: now }).where(and(eq(curriculumUnit.id, id), eq(curriculumUnit.academyId, c.academyId))).returning();
    if (!u) throw notFound('Unit');
    await db.update(curriculumTopic).set({ archivedAt: now }).where(and(eq(curriculumTopic.unitId, id), isNull(curriculumTopic.archivedAt)));
    return { ok: true, archived: true };
  });

  // ---------- Published versions ----------
  app.get('/plans', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { level } = parse(z.object({ level: z.string().max(40).optional() }), req.query);
    return db.select({ id: curriculumPlan.id, level: curriculumPlan.level, version: curriculumPlan.version, notes: curriculumPlan.notes, publishedAt: curriculumPlan.publishedAt, publishedBy: appUser.displayName,
      topics: sql<number>`(select count(*)::int from treoo.curriculum_plan_topic pt where pt.plan_id = ${curriculumPlan.id})`,
      groups: sql<number>`(select count(*)::int from treoo.student_group g where g.plan_id = ${curriculumPlan.id})` })
      .from(curriculumPlan).innerJoin(appUser, eq(appUser.id, curriculumPlan.publishedBy))
      .where(and(eq(curriculumPlan.academyId, c.academyId), level ? eq(curriculumPlan.level, level) : undefined))
      .orderBy(asc(curriculumPlan.level), desc(curriculumPlan.version));
  });

  /** Freezes the current required topics of a level as the next version. Earlier versions never change. */
  app.post('/plans', async (req, reply) => {
    const c = ctx(req, 'admin');
    const b = parse(z.object({ level: reqText(40, 'Level'), notes: optText(1000) }), req.body);
    const units = await tree(c.academyId, b.level);
    const required = units.flatMap((u) => u.topics.filter((t) => t.required).map((t) => ({ unitTitle: u.title, topic: t })));
    if (!required.length) throw badRequest('This level has no required topics to publish yet.');
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`plan:${c.academyId}:${b.level}`}))`);
      const [{ v }] = (await tx.select({ v: sql<number>`coalesce(max(${curriculumPlan.version}), 0)::int + 1` }).from(curriculumPlan)
        .where(and(eq(curriculumPlan.academyId, c.academyId), eq(curriculumPlan.level, b.level)))) as [{ v: number }];
      const [p] = await tx.insert(curriculumPlan).values({ academyId: c.academyId, level: b.level, version: v, notes: b.notes, publishedBy: c.userId }).returning();
      await tx.insert(curriculumPlanTopic).values(required.map((r, i) => ({ planId: p!.id, topicId: r.topic.id, unitTitle: r.unitTitle, topicTitle: r.topic.title, objective: r.topic.objective, position: i })));
      return p!;
    });
    return reply.status(201).send({ ...plan, topics: required.length });
  });

  app.get('/plans/:id', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { id } = parse(uuidParam, req.params);
    const [p] = await db.select().from(curriculumPlan).where(and(eq(curriculumPlan.id, id), eq(curriculumPlan.academyId, c.academyId)));
    if (!p) throw notFound('Curriculum version');
    const topics = await db.select().from(curriculumPlanTopic).where(eq(curriculumPlanTopic.planId, id)).orderBy(asc(curriculumPlanTopic.position));
    return { ...p, topics };
  });

  /**
   * Coverage for a group. With an assigned version, the denominator is that frozen list of required topics;
   * without one, the current required topics of the group's level. A topic counts as taught when a class
   * marked as taught (not cancelled) used a lesson linked to it.
   */
  app.get('/coverage', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { groupId } = parse(z.object({ groupId: z.string().uuid() }), req.query);
    const g = await getGroup(db, c, groupId);
    if (c.role === 'teacher' && g.teacherId !== c.userId) throw forbidden();
    let plan: { id: string; version: number; level: string } | null = null;
    let units: { id: string; title: string; topics: { id: string; title: string; objective: string | null }[] }[];
    if (g.planId) {
      const [p] = await db.select().from(curriculumPlan).where(eq(curriculumPlan.id, g.planId));
      plan = { id: p!.id, version: p!.version, level: p!.level };
      const pts = await db.select().from(curriculumPlanTopic).where(eq(curriculumPlanTopic.planId, g.planId)).orderBy(asc(curriculumPlanTopic.position));
      const byUnit = new Map<string, { id: string; title: string; objective: string | null }[]>();
      for (const t of pts) byUnit.set(t.unitTitle, [...(byUnit.get(t.unitTitle) ?? []), { id: t.topicId, title: t.topicTitle, objective: t.objective }]);
      units = [...byUnit.entries()].map(([title, topics]) => ({ id: title, title, topics }));
    } else {
      if (!g.level) return { level: null, plan: null, units: [], taught: 0, total: 0 };
      units = (await tree(c.academyId, g.level)).map((u) => ({ id: u.id, title: u.title, topics: u.topics.filter((t) => t.required) }));
    }
    const taught = await db.execute<{ topicId: string; lastTaught: string; classes: number }>(sql`
      select l.curriculum_topic_id as "topicId", max(s.scheduled_on)::text as "lastTaught", count(*)::int as classes
      from treoo.class_session s join treoo.lesson l on l.id = s.lesson_id
      where s.academy_id = ${c.academyId} and s.group_id = ${groupId} and s.status = 'delivered' and l.curriculum_topic_id is not null
      group by l.curriculum_topic_id`);
    const byTopic = new Map(taught.rows.map((r) => [r.topicId, r]));
    const out = units.map((u) => ({ ...u, topics: u.topics.map((t) => ({ ...t, taught: byTopic.get(t.id) ?? null })) })).filter((u) => u.topics.length);
    const total = out.reduce((s2, u) => s2 + u.topics.length, 0);
    return { level: plan?.level ?? g.level, plan, units: out, taught: out.reduce((s2, u) => s2 + u.topics.filter((t) => t.taught).length, 0), total };
  });
};
