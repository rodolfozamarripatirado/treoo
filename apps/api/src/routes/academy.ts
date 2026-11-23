import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx } from '../auth/context.js';
import { site, studentGroup } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { optText, parse, reqText, uuidParam } from '../lib/validate.js';

export const academyRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  // ---------- Sites (DEC-02) ----------
  app.get('/sites', async (req) => {
    const c = ctx(req);
    return db.select({ id: site.id, name: site.name, address: site.address,
      groups: sql<number>`(select count(*)::int from treoo.student_group g where g.site_id = ${site.id})` })
      .from(site).where(eq(site.academyId, c.academyId)).orderBy(asc(site.name));
  });
  app.post('/sites', async (req, reply) => {
    const c = ctx(req, 'admin');
    const b = parse(z.object({ name: reqText(120, 'Site name'), address: optText(300) }), req.body);
    const [s] = await db.insert(site).values({ ...b, academyId: c.academyId }).returning();
    return reply.status(201).send(s);
  });
  app.put('/sites/:id', async (req) => {
    const c = ctx(req, 'admin');
    const { id } = parse(uuidParam, req.params);
    const b = parse(z.object({ name: reqText(120, 'Site name'), address: optText(300) }), req.body);
    const [s] = await db.update(site).set(b).where(and(eq(site.id, id), eq(site.academyId, c.academyId))).returning();
    if (!s) throw notFound('Site');
    return s;
  });
  app.put('/groups/:id/site', async (req) => {
    const c = ctx(req, 'admin');
    const { id } = parse(uuidParam, req.params);
    const { siteId } = parse(z.object({ siteId: z.string().uuid().nullable() }), req.body);
    if (siteId) { const [s] = await db.select().from(site).where(and(eq(site.id, siteId), eq(site.academyId, c.academyId))); if (!s) throw badRequest('That site does not belong to this academy.'); }
    const [g] = await db.update(studentGroup).set({ siteId }).where(and(eq(studentGroup.id, id), eq(studentGroup.academyId, c.academyId))).returning();
    if (!g) throw notFound('Group');
    return g;
  });

  /**
   * Active students per month (REQ-069–071). PROPOSED rule, pending the commercial decision (DEC-04):
   * a student counts as active in a month if enrolled in a group of the academy and attended
   * (present or late) at least one class that month. Each student is counted once per academy.
   */
  app.get('/billing/active-students', async (req, reply) => {
    const c = ctx(req, 'admin');
    const { month, format } = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Use the format YYYY-MM.'), format: z.enum(['json', 'csv']).default('json') }), req.query);
    const res = await db.execute<{ id: string; displayName: string; email: string; classesAttended: number; groups: string }>(sql`
      select u.id, u.display_name as "displayName", u.email,
        count(distinct s.id)::int as "classesAttended", string_agg(distinct g.name, '; ') as groups
      from treoo.attendance a
      join treoo.class_session s on s.id = a.session_id
      join treoo.student_group g on g.id = s.group_id
      join treoo.app_user u on u.id = a.student_id
      where a.academy_id = ${c.academyId} and a.status in ('present', 'late')
        and to_char(s.scheduled_on, 'YYYY-MM') = ${month}
      group by u.id, u.display_name, u.email order by u.display_name`);
    const enrolled = await db.execute<{ n: number }>(sql`
      select count(distinct student_id)::int as n from treoo.enrollment where academy_id = ${c.academyId}`);
    if (format === 'csv') {
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = ['name,email,classes_attended,groups', ...res.rows.map((r) => [r.displayName, r.email, r.classesAttended, r.groups].map(esc).join(','))].join('\n');
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="active-students-${month}.csv"`);
      return csv;
    }
    return { month, rule: 'Enrolled and attended at least one class in the month (proposal, pending DEC-04).', active: res.rows.length, enrolled: enrolled.rows[0]?.n ?? 0, students: res.rows };
  });
};
