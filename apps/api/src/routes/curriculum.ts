import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx } from '../auth/context.js';
import { curriculumTopic, curriculumUnit } from '../db/schema.js';
import { getGroup } from '../lib/access.js';
import { forbidden, notFound } from '../lib/errors.js';
import { optText, parse, reqText, uuidParam } from '../lib/validate.js';

const TopicBody = z.object({ id: z.string().uuid().optional(), title: reqText(200, 'Topic'), objective: optText(1000), skill: optText(40) });
const UnitBody = z.object({ level: reqText(40, 'Level'), title: reqText(200, 'Unit title'), description: optText(1000), topics: z.array(TopicBody).max(40).default([]) });

/** Academy curriculum: levels → units → topics. Admins edit; teachers read and link lessons to topics. */
export const curriculumRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  const tree = async (academyId: string, level?: string) => {
    const units = await db.select().from(curriculumUnit).where(and(eq(curriculumUnit.academyId, academyId), level ? eq(curriculumUnit.level, level) : undefined))
      .orderBy(asc(curriculumUnit.level), asc(curriculumUnit.position));
    const topics = units.length ? await db.select().from(curriculumTopic).where(inArray(curriculumTopic.unitId, units.map((u) => u.id))).orderBy(asc(curriculumTopic.position)) : [];
    return units.map((u) => ({ ...u, topics: topics.filter((t) => t.unitId === u.id) }));
  };

  app.get('/', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { level } = parse(z.object({ level: z.string().max(40).optional() }), req.query);
    return tree(c.academyId, level);
  });

  const writeTopics = async (academyId: string, unitId: string, topics: z.infer<typeof TopicBody>[]) => {
    const keep = topics.map((t) => t.id).filter((x): x is string => !!x);
    const existing = await db.select({ id: curriculumTopic.id }).from(curriculumTopic).where(eq(curriculumTopic.unitId, unitId));
    const drop = existing.map((e) => e.id).filter((x) => !keep.includes(x));
    if (drop.length) await db.delete(curriculumTopic).where(inArray(curriculumTopic.id, drop));
    for (const [i, t] of topics.entries()) {
      const v = { title: t.title, objective: t.objective, skill: t.skill, position: i };
      if (t.id && existing.some((e) => e.id === t.id)) await db.update(curriculumTopic).set(v).where(eq(curriculumTopic.id, t.id));
      else await db.insert(curriculumTopic).values({ ...v, academyId, unitId });
    }
  };

  app.post('/units', async (req, reply) => {
    const c = ctx(req, 'admin');
    const b = parse(UnitBody, req.body);
    const [{ n }] = (await db.select({ n: sql<number>`coalesce(max(${curriculumUnit.position}) + 1, 0)::int` }).from(curriculumUnit)
      .where(and(eq(curriculumUnit.academyId, c.academyId), eq(curriculumUnit.level, b.level)))) as [{ n: number }];
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
    await db.delete(curriculumUnit).where(and(eq(curriculumUnit.id, id), eq(curriculumUnit.academyId, c.academyId)));
    return { ok: true };
  });

  /** Coverage for a group: which curriculum topics of its level were taught (delivered class with a lesson linked to the topic). */
  app.get('/coverage', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { groupId } = parse(z.object({ groupId: z.string().uuid() }), req.query);
    const g = await getGroup(db, c, groupId);
    if (c.role === 'teacher' && g.teacherId !== c.userId) throw forbidden();
    if (!g.level) return { level: null, units: [], taught: 0, total: 0 };
    const units = await tree(c.academyId, g.level);
    const taught = await db.execute<{ topicId: string; lastTaught: string; classes: number }>(sql`
      select l.curriculum_topic_id as "topicId", max(s.scheduled_on)::text as "lastTaught", count(*)::int as classes
      from treoo.class_session s join treoo.lesson l on l.id = s.lesson_id
      where s.academy_id = ${c.academyId} and s.group_id = ${groupId} and s.status = 'delivered' and l.curriculum_topic_id is not null
      group by l.curriculum_topic_id`);
    const byTopic = new Map(taught.rows.map((r) => [r.topicId, r]));
    const out = units.map((u) => ({ ...u, topics: u.topics.map((t) => ({ ...t, taught: byTopic.get(t.id) ?? null })) }));
    const total = out.reduce((s, u) => s + u.topics.length, 0);
    return { level: g.level, units: out, taught: out.reduce((s, u) => s + u.topics.filter((t) => t.taught).length, 0), total };
  });
};
