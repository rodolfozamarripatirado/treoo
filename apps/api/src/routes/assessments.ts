import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx, type Ctx } from '../auth/context.js';
import type { Db } from '../db/client.js';
import { appUser, assessment, enrollment, studentGroup } from '../db/schema.js';
import { memberRole } from '../lib/access.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { isoDate, optText, parse, uuidParam } from '../lib/validate.js';

const Skill = z.object({ score: z.number().min(0), max: z.number().positive() }).refine((s) => s.score <= s.max, 'Score cannot be higher than the maximum.');
const Body = z.object({
  studentId: z.string().uuid(),
  groupId: z.string().uuid().nullable().optional(),
  kind: z.enum(['baseline', 'checkpoint', 'final', 'quiz']),
  takenOn: isoDate,
  instrument: optText(300),
  scores: z.object({ reading: Skill.optional(), listening: Skill.optional(), speaking: Skill.optional(), writing: Skill.optional(), grammar: Skill.optional() })
    .refine((s) => Object.values(s).some(Boolean), 'Add at least one skill score.'),
  cefr: z.enum(['Pre-A1', 'A1', 'A2', 'B1', 'B1+', 'B2', 'B2+', 'C1', 'C2']).nullable().optional(),
  strengths: optText(2000),
  nextSteps: optText(2000),
  sharedWithStudent: z.boolean().default(true),
});

/** Teachers assess students in groups they teach; admins any student of the academy. */
async function canAssess(db: Db, c: Ctx, studentId: string) {
  if (await memberRole(db, c.academyId, studentId) !== 'student') throw badRequest('That person is not a student of this academy.');
  if (c.role === 'admin') return;
  const [x] = await db.select({ g: enrollment.groupId }).from(enrollment).innerJoin(studentGroup, eq(studentGroup.id, enrollment.groupId))
    .where(and(eq(enrollment.studentId, studentId), eq(enrollment.academyId, c.academyId), eq(studentGroup.teacherId, c.userId))).limit(1);
  if (!x) throw notFound('Student');
}

export const assessmentRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  app.get('/', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { studentId } = parse(z.object({ studentId: z.string().uuid() }), req.query);
    await canAssess(db, c, studentId);
    return db.select({ a: assessment, assessorName: appUser.displayName }).from(assessment).innerJoin(appUser, eq(appUser.id, assessment.assessorId))
      .where(and(eq(assessment.academyId, c.academyId), eq(assessment.studentId, studentId))).orderBy(desc(assessment.takenOn))
      .then((r) => r.map((x) => ({ ...x.a, assessorName: x.assessorName })));
  });

  app.post('/', async (req, reply) => {
    const c = ctx(req, 'admin', 'teacher');
    const b = parse(Body, req.body);
    await canAssess(db, c, b.studentId);
    const [a] = await db.insert(assessment).values({ ...b, groupId: b.groupId ?? null, cefr: b.cefr ?? null, academyId: c.academyId, assessorId: c.userId }).returning();
    return reply.status(201).send(a);
  });

  app.delete('/:id', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { id } = parse(uuidParam, req.params);
    const [a] = await db.select().from(assessment).where(and(eq(assessment.id, id), eq(assessment.academyId, c.academyId)));
    if (!a) throw notFound('Assessment');
    if (a.assessorId !== c.userId && c.role !== 'admin') throw forbidden('Only the assessor or an admin can delete this.');
    await db.delete(assessment).where(eq(assessment.id, id));
    return { ok: true };
  });

  /** Student view: only assessments the teacher chose to share. */
  app.get('/mine', async (req) => {
    const c = ctx(req, 'student');
    return db.select({ id: assessment.id, kind: assessment.kind, takenOn: assessment.takenOn, instrument: assessment.instrument, scores: assessment.scores,
      cefr: assessment.cefr, strengths: assessment.strengths, nextSteps: assessment.nextSteps })
      .from(assessment).where(and(eq(assessment.academyId, c.academyId), eq(assessment.studentId, c.userId), eq(assessment.sharedWithStudent, true)))
      .orderBy(desc(assessment.takenOn));
  });
};
