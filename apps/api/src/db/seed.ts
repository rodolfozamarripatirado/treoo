import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth/password.js';
import { loadEnv } from '../env.js';
import { createDb, type Db } from './client.js';
import * as s from './schema.js';

/**
 * Fictitious demo data only (TD-00). Fixed UUIDs make the seed repeatable: it does nothing
 * if the demo academy already exists. Two academies prove isolation.
 */
export const DEMO_PASSWORD = 'Treoo-demo-2026';
const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const IDS = {
  academyA: id('10000000', 1), academyB: id('10000000', 2),
  admin: id('20000000', 1), ana: id('20000000', 2), alex: id('20000000', 3), bruno: id('20000000', 4),
  sam: id('30000000', 1), lucia: id('30000000', 2), tomas: id('30000000', 3), mei: id('30000000', 4), noah: id('30000000', 5),
  groupB1: id('40000000', 1), groupB2: id('40000000', 2), groupWestport: id('40000000', 3),
  lesson: id('50000000', 1), material: id('60000000', 1), pastSession: id('70000000', 1), todaySession: id('70000000', 2),
};

const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

export async function seed(db: Db): Promise<boolean> {
  const [exists] = await db.select().from(s.academy).where(eq(s.academy.id, IDS.academyA));
  if (exists) return false;
  const pw = await hashPassword(DEMO_PASSWORD);
  await db.transaction(async (tx) => {
    await tx.insert(s.academy).values([
      { id: IDS.academyA, name: 'Northbridge English Academy (demo)' },
      { id: IDS.academyB, name: 'Westport School of English (demo)' },
    ]);
    const users = [
      [IDS.admin, 'olivia@northbridge.demo', 'Olivia Grant'],
      [IDS.ana, 'ana@northbridge.demo', 'Ana Ruiz'],
      [IDS.alex, 'alex@northbridge.demo', 'Alex Byrne'],
      [IDS.bruno, 'bruno@westport.demo', 'Bruno Costa'],
      [IDS.sam, 'sam@northbridge.demo', 'Sam Kelly'],
      [IDS.lucia, 'lucia@northbridge.demo', 'Lucía Méndez'],
      [IDS.tomas, 'tomas@northbridge.demo', 'Tomás Novak'],
      [IDS.mei, 'mei@northbridge.demo', 'Mei Tanaka'],
      [IDS.noah, 'noah@westport.demo', 'Noah Walsh'],
    ] as const;
    await tx.insert(s.appUser).values(users.map(([uid, email, displayName]) => ({ id: uid, email, displayName, passwordHash: pw })));
    await tx.insert(s.membership).values([
      { academyId: IDS.academyA, userId: IDS.admin, role: 'admin' },
      { academyId: IDS.academyA, userId: IDS.ana, role: 'teacher' },
      { academyId: IDS.academyA, userId: IDS.alex, role: 'teacher' },
      { academyId: IDS.academyB, userId: IDS.bruno, role: 'teacher' },
      ...[IDS.sam, IDS.lucia, IDS.tomas, IDS.mei].map((u) => ({ academyId: IDS.academyA, userId: u, role: 'student' as const })),
      { academyId: IDS.academyB, userId: IDS.noah, role: 'student' },
      // Ana also teaches a few hours at the second academy: one person, two isolated contexts.
      { academyId: IDS.academyB, userId: IDS.ana, role: 'teacher' },
    ]);
    await tx.insert(s.studentGroup).values([
      { id: IDS.groupB1, academyId: IDS.academyA, name: 'B1+ Grammar — Morning', level: 'B1+', schedule: 'Mon–Fri 09:00–11:00', teacherId: IDS.ana },
      { id: IDS.groupB2, academyId: IDS.academyA, name: 'B2 Conversation — Morning', level: 'B2', schedule: 'Mon–Fri 11:00–13:00', teacherId: IDS.alex },
      { id: IDS.groupWestport, academyId: IDS.academyB, name: 'A2 Evening', level: 'A2', schedule: 'Tue/Thu 18:00–20:00', teacherId: IDS.bruno },
    ]);
    await tx.insert(s.enrollment).values([
      ...[IDS.sam, IDS.lucia, IDS.tomas, IDS.mei].map((u) => ({ academyId: IDS.academyA, groupId: IDS.groupB1, studentId: u })),
      ...[IDS.sam, IDS.lucia].map((u) => ({ academyId: IDS.academyA, groupId: IDS.groupB2, studentId: u })),
      { academyId: IDS.academyB, groupId: IDS.groupWestport, studentId: IDS.noah },
    ]);
    const worksheet = [
      'Unit 4 — Present Perfect: life experiences',
      '',
      'We use the present perfect (have/has + past participle) to talk about experiences at an unspecified time in our lives.',
      'Use "ever" in questions and "never" in negative statements. Use the past simple when we say when it happened.',
      '',
      'A. Complete the sentences.',
      '1. I ___ (be) to Scotland twice.',
      '2. ___ you ever ___ (eat) sushi?',
      '3. She ___ (never / see) the sea.',
      '',
      'B. Speaking: Find someone who has… (ridden a horse / met a famous person / lost a phone).',
    ].join('\n');
    await tx.insert(s.material).values({ id: IDS.material, academyId: IDS.academyA, ownerId: IDS.ana, title: 'Unit 4 worksheet — Present Perfect', source: 'Teacher-made worksheet (demo)', sourceText: worksheet, extractedText: worksheet, extractionStatus: 'manual' });
    await tx.insert(s.lesson).values({
      id: IDS.lesson, academyId: IDS.academyA, ownerId: IDS.ana, materialId: IDS.material, status: 'ready',
      title: 'Present Perfect: life experiences', topic: 'Present Perfect', level: 'B1+',
      objective: 'Students can ask and answer about life experiences using the present perfect with ever/never, and switch to the past simple for specific times.',
      methodology: 'Test–teach–test with pair work and delayed error correction.',
      notes: 'Watch for "I have been in…" vs "I have been to…".',
    });
    await tx.insert(s.activity).values([
      { lessonId: IDS.lesson, academyId: IDS.academyA, position: 0, kind: 'warm-up', title: 'Have you ever…? mingle', instructions: 'Students ask three classmates about unusual experiences.', durationMinutes: 10 },
      { lessonId: IDS.lesson, academyId: IDS.academyA, position: 1, kind: 'presentation', title: 'Form and use', instructions: 'Elicit have/has + past participle; contrast with past simple timeline.', durationMinutes: 20 },
      { lessonId: IDS.lesson, academyId: IDS.academyA, position: 2, kind: 'controlled practice', title: 'Worksheet part A', instructions: 'Pairs complete items 1–3, then check as a class.', durationMinutes: 7.5 },
      { lessonId: IDS.lesson, academyId: IDS.academyA, position: 3, kind: 'speaking', title: 'Find someone who…', instructions: 'Part B. Follow-up question in the past simple: When? Where?', durationMinutes: null },
    ]);
    const [e1, e2, e3] = await tx.insert(s.exercise).values([
      { academyId: IDS.academyA, ownerId: IDS.ana, lessonId: IDS.lesson, topic: 'Present Perfect', type: 'single_choice', prompt: 'Choose the correct sentence.', options: ['I have been to Scotland last year.', 'I have been to Scotland twice.', 'I am to Scotland twice.'], correctAnswer: 1, points: 1 },
      { academyId: IDS.academyA, ownerId: IDS.ana, lessonId: IDS.lesson, topic: 'Present Perfect', type: 'true_false', prompt: '"Have you ever eaten sushi?" is grammatically correct.', options: null, correctAnswer: true, points: 1 },
      { academyId: IDS.academyA, ownerId: IDS.ana, lessonId: IDS.lesson, topic: 'Present Perfect', type: 'short_answer', prompt: 'Write two sentences about something you have never done.', options: null, correctAnswer: null, points: 2 },
    ]).returning();
    await tx.insert(s.classSession).values([
      { id: IDS.pastSession, academyId: IDS.academyA, groupId: IDS.groupB1, lessonId: IDS.lesson, teacherId: IDS.ana, scheduledOn: day(-3), topic: 'Present Perfect', status: 'delivered', deliveredAt: new Date(), publishedAt: new Date(), sharedNotes: 'Remember: been TO a place. Homework: tasks below.', privateNotes: 'Tomás struggled with irregular participles — follow up.' },
      { id: IDS.todaySession, academyId: IDS.academyA, groupId: IDS.groupB1, lessonId: IDS.lesson, teacherId: IDS.ana, scheduledOn: day(0), topic: 'Present Perfect' },
    ]);
    await tx.insert(s.attendance).values([
      { academyId: IDS.academyA, sessionId: IDS.pastSession, studentId: IDS.sam, status: 'present' },
      { academyId: IDS.academyA, sessionId: IDS.pastSession, studentId: IDS.lucia, status: 'present' },
      { academyId: IDS.academyA, sessionId: IDS.pastSession, studentId: IDS.tomas, status: 'late' },
      { academyId: IDS.academyA, sessionId: IDS.pastSession, studentId: IDS.mei, status: 'absent' },
    ]);
    const asg = await tx.insert(s.assignment).values([e1!, e2!, e3!].map((e) => ({ academyId: IDS.academyA, groupId: IDS.groupB1, exerciseId: e.id, sessionId: IDS.pastSession, dueOn: day(4) }))).returning();
    await tx.insert(s.attempt).values([
      { academyId: IDS.academyA, assignmentId: asg[0]!.id, studentId: IDS.lucia, answer: 1, autoScore: 1 },
      { academyId: IDS.academyA, assignmentId: asg[1]!.id, studentId: IDS.lucia, answer: true, autoScore: 1 },
      { academyId: IDS.academyA, assignmentId: asg[0]!.id, studentId: IDS.tomas, answer: 0, autoScore: 0 },
      { academyId: IDS.academyA, assignmentId: asg[2]!.id, studentId: IDS.tomas, answer: 'I have never ridden a horse. I have never seen snow.', autoScore: null },
    ]);
  });
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { db, pool } = createDb(loadEnv().DATABASE_URL);
  seed(db)
    .then((created) => console.log(created ? 'Demo data created.' : 'Demo data already present — nothing to do.'))
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
}
