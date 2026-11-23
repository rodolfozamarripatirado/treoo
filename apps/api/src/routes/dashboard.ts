import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { ctx } from '../auth/context.js';
import { academyTimeZone, localToday } from '../lib/schedule.js';

/**
 * The teacher's "Today" screen. Everything is scoped to the groups the teacher teaches
 * (admins see the whole academy). Attention flags are prompts to look closer, not judgements.
 */
export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  app.get('/', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const mine = c.role === 'teacher' ? sql`and g.teacher_id = ${c.userId}` : sql``;
    const today = localToday(await academyTimeZone(db, c.academyId));

    const classes = await db.execute(sql`
      select s.id, s.scheduled_on as "scheduledOn", to_char(s.start_time, 'HH24:MI') as "startTime", to_char(s.end_time, 'HH24:MI') as "endTime",
        s.status, s.cancelled_reason as "cancelledReason", s.published_at as "publishedAt", s.topic,
        g.id as "groupId", g.name as "groupName", g.schedule, l.id as "lessonId", l.title as "lessonTitle",
        (select count(*)::int from treoo.enrollment e where e.group_id = g.id) as students,
        (select count(*)::int from treoo.attendance a where a.session_id = s.id) as "attendanceTaken"
      from treoo.class_session s join treoo.student_group g on g.id = s.group_id
      left join treoo.lesson l on l.id = s.lesson_id
      where s.academy_id = ${c.academyId} ${mine}
        and s.scheduled_on between ${today}::date and ${today}::date + 6
      order by s.scheduled_on, s.start_time nulls last, g.name`);

    const toPublish = await db.execute(sql`
      select s.id, s.scheduled_on as "scheduledOn", g.name as "groupName", s.topic
      from treoo.class_session s join treoo.student_group g on g.id = s.group_id
      where s.academy_id = ${c.academyId} ${mine} and s.status = 'delivered' and s.published_at is null
      order by s.scheduled_on desc limit 10`);

    const toMark = await db.execute(sql`
      select a.id as "assignmentId", g.id as "groupId", g.name as "groupName", e.prompt, count(*)::int as pending
      from treoo.attempt t join treoo.assignment a on a.id = t.assignment_id
      join treoo.exercise e on e.id = a.exercise_id join treoo.student_group g on g.id = a.group_id
      where t.academy_id = ${c.academyId} ${mine} and t.auto_score is null and t.teacher_score is null
      group by a.id, g.id, g.name, e.prompt order by count(*) desc limit 20`);

    // Students who missed 2+ of the last classes, or whose latest answers average under 50%.
    const attention = await db.execute(sql`
      with my_groups as (select g.id, g.name from treoo.student_group g where g.academy_id = ${c.academyId} ${mine}),
      recent as (
        select a.student_id, s.group_id,
          count(*) filter (where a.status = 'absent')::int as absences,
          count(*)::int as classes
        from treoo.attendance a join treoo.class_session s on s.id = a.session_id
        where s.group_id in (select id from my_groups) and s.status <> 'cancelled' and s.scheduled_on >= ${today}::date - 30
        group by a.student_id, s.group_id),
      latest as (
        select t.student_id, a.group_id, coalesce(t.teacher_score, t.auto_score) / e.points as ratio,
          row_number() over (partition by t.assignment_id, t.student_id order by t.created_at desc) as rn
        from treoo.attempt t join treoo.assignment a on a.id = t.assignment_id join treoo.exercise e on e.id = a.exercise_id
        where a.group_id in (select id from my_groups)),
      scores as (
        select student_id, group_id, round(100 * avg(ratio))::int as avg, count(*)::int as answers
        from latest where rn = 1 and ratio is not null group by student_id, group_id)
      select u.id, u.display_name as "displayName", mg.name as "groupName", mg.id as "groupId",
        coalesce(r.absences, 0) as absences, coalesce(r.classes, 0) as classes, sc.avg as "avgScore", coalesce(sc.answers, 0) as answers
      from treoo.enrollment en join my_groups mg on mg.id = en.group_id join treoo.app_user u on u.id = en.student_id
      left join recent r on r.student_id = en.student_id and r.group_id = en.group_id
      left join scores sc on sc.student_id = en.student_id and sc.group_id = en.group_id
      where coalesce(r.absences, 0) >= 2 or (sc.answers >= 2 and sc.avg < 50)
      order by coalesce(r.absences, 0) desc, sc.avg nulls last limit 20`);

    const drafts = await db.execute(sql`
      select l.id, l.title, l.topic, l.updated_at as "updatedAt"
      from treoo.lesson l where l.academy_id = ${c.academyId} and l.owner_id = ${c.userId} and l.status = 'draft'
      order by l.updated_at desc limit 5`);

    return {
      today,
      classes: classes.rows,
      toPublish: toPublish.rows,
      toMark: toMark.rows,
      attention: (attention.rows as { absences: number; avgScore: number | null; answers: number }[]).map((r) => ({
        ...r,
        reasons: [
          r.absences >= 2 ? `${r.absences} absences in the last 30 days` : null,
          r.answers >= 2 && r.avgScore != null && r.avgScore < 50 ? `task average ${r.avgScore}%` : null,
        ].filter(Boolean),
      })),
      drafts: drafts.rows,
    };
  });
};
