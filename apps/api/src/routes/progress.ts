import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx } from '../auth/context.js';
import { getManagedGroup } from '../lib/access.js';
import { parse } from '../lib/validate.js';

/**
 * Basic follow-up (REQ-065–067). Scores use each student's latest attempt (teacher score overrides auto score).
 * Figures describe evidence available in Treoo; they are not rankings of teachers or official grades.
 */
export const progressRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  app.get('/overview', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const f = parse(z.object({ siteId: z.string().uuid().optional(), teacherId: z.string().uuid().optional() }), req.query);
    const res = await db.execute(sql`
      select g.id, g.name, g.level, u.display_name as "teacherName", g.teacher_id as "teacherId", st.name as "siteName",
        (select count(*)::int from treoo.enrollment e where e.group_id = g.id) as students,
        (select count(*)::int from treoo.class_session s where s.group_id = g.id and s.status = 'delivered') as "classesDelivered",
        -- (present + late) / (present + late + absent). Excused and untaken registers are not absences (A01 rule).
        (select round(100.0 * count(*) filter (where a.status in ('present','late')) / nullif(count(*) filter (where a.status in ('present','late','absent')), 0))::int
           from treoo.attendance a join treoo.class_session s on s.id = a.session_id where s.group_id = g.id and s.status <> 'cancelled') as "attendanceRate",
        (select round(100 * avg(x.score / x.points))::int from (
           select distinct on (t.assignment_id, t.student_id) coalesce(t.teacher_score, t.auto_score) as score, e.points
           from treoo.attempt t join treoo.assignment a on a.id = t.assignment_id join treoo.exercise e on e.id = a.exercise_id
           where a.group_id = g.id order by t.assignment_id, t.student_id, t.created_at desc) x) as "avgScore"
      from treoo.student_group g left join treoo.app_user u on u.id = g.teacher_id left join treoo.site st on st.id = g.site_id
      where g.academy_id = ${c.academyId} ${c.role === 'teacher' ? sql`and g.teacher_id = ${c.userId}` : sql``}
        ${f.siteId ? sql`and g.site_id = ${f.siteId}` : sql``} ${f.teacherId ? sql`and g.teacher_id = ${f.teacherId}` : sql``}
      order by g.name`);
    return res.rows;
  });

  app.get('/group', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { groupId } = parse(z.object({ groupId: z.string().uuid() }), req.query);
    await getManagedGroup(db, c, groupId);
    const students = await db.execute(sql`
      select u.id, u.display_name as "displayName",
        count(a.*) filter (where a.status = 'present')::int as present,
        count(a.*) filter (where a.status = 'late')::int as late,
        count(a.*) filter (where a.status = 'absent')::int as absent,
        count(a.*) filter (where a.status = 'excused')::int as excused,
        (select round(100 * avg(x.score / x.points))::int from (
           select distinct on (t.assignment_id) coalesce(t.teacher_score, t.auto_score) as score, e.points
           from treoo.attempt t join treoo.assignment asg on asg.id = t.assignment_id join treoo.exercise e on e.id = asg.exercise_id
           where asg.group_id = ${groupId} and t.student_id = u.id order by t.assignment_id, t.created_at desc) x) as "avgScore"
      from treoo.enrollment en join treoo.app_user u on u.id = en.student_id
      left join treoo.attendance a on a.student_id = u.id and a.session_id in (select id from treoo.class_session where group_id = ${groupId} and status <> 'cancelled')
      where en.group_id = ${groupId}
      group by u.id, u.display_name order by u.display_name`);
    const topics = await db.execute(sql`
      with latest as (
        select distinct on (t.assignment_id, t.student_id) t.assignment_id, coalesce(t.teacher_score, t.auto_score) as score
        from treoo.attempt t join treoo.assignment a on a.id = t.assignment_id where a.group_id = ${groupId}
        order by t.assignment_id, t.student_id, t.created_at desc)
      , per_topic as (
        select coalesce(e.topic, 'General') as topic, count(l.*)::int as answers,
          round(100 * avg(l.score / e.points))::int as "avgScore",
          count(*) filter (where l.assignment_id is not null and l.score is null)::int as "pendingReview"
        from treoo.assignment a join treoo.exercise e on e.id = a.exercise_id left join latest l on l.assignment_id = a.id
        where a.group_id = ${groupId} group by 1)
      select p.*, (select count(*)::int from treoo.class_session s
                   where s.group_id = ${groupId} and s.status = 'delivered' and coalesce(s.topic, 'General') = p.topic) as classes
      from per_topic p order by p.topic`);
    return { students: students.rows, topics: topics.rows };
  });
};
