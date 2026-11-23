import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth/password.js';
import { loadEnv } from '../env.js';
import { createDb, type Db } from './client.js';
import * as s from './schema.js';
import { buildSnapshot } from '../lib/schedule.js';

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
    await tx.insert(s.site).values([
      { id: id('80000000', 1), academyId: IDS.academyA, name: 'City Centre', address: '12 Example Street (demo)' },
      { id: id('80000000', 2), academyId: IDS.academyA, name: 'Riverside', address: '3 Sample Quay (demo)' },
    ]);
    await tx.insert(s.room).values([
      { id: id('81000000', 1), academyId: IDS.academyA, siteId: id('80000000', 1), name: 'Room 1', capacity: 12 },
      { id: id('81000000', 2), academyId: IDS.academyA, siteId: id('80000000', 1), name: 'Room 2', capacity: 10 },
      { id: id('81000000', 3), academyId: IDS.academyA, siteId: id('80000000', 2), name: 'River Room', capacity: 14 },
    ]);
    await tx.insert(s.studentGroup).values([
      { id: IDS.groupB1, academyId: IDS.academyA, name: 'B1+ Grammar — Morning', level: 'B1+', schedule: 'Mon–Fri 09:00–11:00', teacherId: IDS.ana, siteId: id('80000000', 1) },
      { id: IDS.groupB2, academyId: IDS.academyA, name: 'B2 Conversation — Morning', level: 'B2', schedule: 'Mon–Fri 11:00–13:00', teacherId: IDS.alex, siteId: id('80000000', 2) },
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
    // Curriculum for B1+: units and topics with objectives.
    const units = [
      ['Unit 1 — Life experiences', [['Present Perfect', 'Talk about experiences with ever/never', 'grammar'], ['Past simple vs present perfect', 'Choose the right tense for finished time', 'grammar'], ['Telling an anecdote', 'Tell a short story about a memorable experience', 'speaking']]],
      ['Unit 2 — Plans and predictions', [['Future forms', 'Use will, going to and present continuous for plans', 'grammar'], ['Making arrangements', 'Arrange to meet by message and phone', 'speaking'], ['Writing an email invitation', 'Write a short informal invitation', 'writing']]],
      ['Unit 3 — Hypotheticals', [['Second conditional', 'Talk about imaginary situations', 'grammar'], ['Listening: radio interview', 'Understand the main points of an interview', 'listening']]],
    ] as const;
    let presentPerfectTopic = '';
    for (const [ui, [title, topics]] of units.entries()) {
      const [u] = await tx.insert(s.curriculumUnit).values({ academyId: IDS.academyA, level: 'B1+', position: ui, title }).returning();
      const ts = await tx.insert(s.curriculumTopic).values(topics.map(([t, objective, skill], i) => ({ academyId: IDS.academyA, unitId: u!.id, position: i, title: t, objective, skill }))).returning();
      if (ui === 0) presentPerfectTopic = ts[0]!.id;
    }
    await tx.insert(s.lesson).values({
      curriculumTopicId: presentPerfectTopic,
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
    const [e1, e2, e3, e4] = await tx.insert(s.exercise).values([
      { academyId: IDS.academyA, ownerId: IDS.ana, lessonId: IDS.lesson, topic: 'Present Perfect', type: 'single_choice', prompt: 'Choose the correct sentence.', options: ['I have been to Scotland last year.', 'I have been to Scotland twice.', 'I am to Scotland twice.'], correctAnswer: 1, points: 1 },
      { academyId: IDS.academyA, ownerId: IDS.ana, lessonId: IDS.lesson, topic: 'Present Perfect', type: 'true_false', prompt: '"Have you ever eaten sushi?" is grammatically correct.', options: null, correctAnswer: true, points: 1 },
      { academyId: IDS.academyA, ownerId: IDS.ana, lessonId: IDS.lesson, topic: 'Present Perfect', type: 'short_answer', prompt: 'Write two sentences about something you have never done.', options: null, correctAnswer: null, points: 2 },
      { academyId: IDS.academyA, ownerId: IDS.ana, lessonId: IDS.lesson, topic: 'Present Perfect', type: 'gap_fill', prompt: 'I {{have been}} to Scotland twice. {{Have|Has}} you ever eaten sushi? She has never {{seen}} the sea.', options: null, correctAnswer: [['have been'], ['Have', 'Has'], ['seen']], points: 3 },
    ]).returning();
    await tx.insert(s.vocabItem).values([
      ['have been to', 'phrase', 'have visited a place and come back', 'I have been to Scotland twice.'],
      ['ever', 'adverb', 'at any time in your life (in questions)', 'Have you ever eaten sushi?'],
      ['never', 'adverb', 'not at any time', 'She has never seen the sea.'],
      ['past participle', 'noun', 'the verb form used after have/has, e.g. seen, been, eaten', '"Eaten" is the past participle of "eat".'],
      ['experience', 'noun', 'something that has happened to you', 'Riding a horse was a great experience.'],
      ['ride a horse', 'collocation', 'sit on a horse and control it as it moves', 'Have you ever ridden a horse?'],
    ].map(([term, partOfSpeech, meaning, example], position) => ({ academyId: IDS.academyA, lessonId: IDS.lesson, position, term: term!, partOfSpeech, meaning, example })));
    await tx.insert(s.classSession).values([
      { id: IDS.pastSession, academyId: IDS.academyA, groupId: IDS.groupB1, lessonId: IDS.lesson, teacherId: IDS.ana, scheduledOn: day(-3), startTime: '09:00', endTime: '11:00', roomId: id('81000000', 1), topic: 'Present Perfect', status: 'delivered', deliveredAt: new Date(), publishedAt: new Date(), shareMaterial: 1, sharedNotes: 'Remember: been TO a place. Homework: tasks below.', privateNotes: 'Tomás struggled with irregular participles — follow up.' },
      { id: IDS.todaySession, academyId: IDS.academyA, groupId: IDS.groupB1, lessonId: IDS.lesson, teacherId: IDS.ana, scheduledOn: day(0), startTime: '09:00', endTime: '11:00', roomId: id('81000000', 1), topic: 'Present Perfect' },
      { academyId: IDS.academyA, groupId: IDS.groupB2, lessonId: null, teacherId: IDS.alex, scheduledOn: day(0), startTime: '11:00', endTime: '13:00', roomId: id('81000000', 1), topic: 'Conversation: travel' },
    ]);
    // An older class so the "needs attention" signal has something to show.
    await tx.insert(s.classSession).values({ id: id('70000000', 3), academyId: IDS.academyA, groupId: IDS.groupB1, lessonId: IDS.lesson, teacherId: IDS.ana, scheduledOn: day(-6), startTime: '09:00', endTime: '11:00', topic: 'Present Perfect', status: 'delivered', deliveredAt: new Date(), publishedAt: null, sharedNotes: 'Intro to experiences.' });
    await tx.insert(s.attendance).values([
      { academyId: IDS.academyA, sessionId: id('70000000', 3), studentId: IDS.sam, status: 'present' },
      { academyId: IDS.academyA, sessionId: id('70000000', 3), studentId: IDS.lucia, status: 'present' },
      { academyId: IDS.academyA, sessionId: id('70000000', 3), studentId: IDS.tomas, status: 'present' },
      { academyId: IDS.academyA, sessionId: id('70000000', 3), studentId: IDS.mei, status: 'absent' },
    ]);
    await tx.insert(s.assessment).values([
      { academyId: IDS.academyA, studentId: IDS.sam, groupId: IDS.groupB1, assessorId: IDS.ana, kind: 'baseline', takenOn: day(-20), instrument: 'Placement test (demo)', cefr: 'B1',
        scores: { reading: { score: 14, max: 20 }, listening: { score: 12, max: 20 }, speaking: { score: 13, max: 20 }, writing: { score: 11, max: 20 }, grammar: { score: 15, max: 20 } },
        strengths: 'Confident reader; good range of everyday vocabulary.', nextSteps: 'Work on listening to fast natural speech and paragraph structure in writing.' },
      { academyId: IDS.academyA, studentId: IDS.sam, groupId: IDS.groupB1, assessorId: IDS.ana, kind: 'checkpoint', takenOn: day(-2), instrument: 'Week 5 checkpoint (demo)', cefr: 'B1+',
        scores: { reading: { score: 16, max: 20 }, listening: { score: 14, max: 20 }, speaking: { score: 15, max: 20 }, writing: { score: 13, max: 20 }, grammar: { score: 16, max: 20 } },
        strengths: 'Clear progress in speaking fluency.', nextSteps: 'Keep a weekly writing journal.' },
    ]);
    await tx.insert(s.calendarEvent).values([
      { academyId: IDS.academyA, kind: 'holiday', title: 'Christmas break', startsOn: '2026-12-21', endsOn: '2027-01-01' },
      { academyId: IDS.academyA, kind: 'event', title: 'English film night', description: 'Watch a British comedy with subtitles, then discuss it.', startsOn: day(5), endsOn: day(5), capacity: 20, signupOpen: true, siteId: id('80000000', 1) },
      { academyId: IDS.academyA, kind: 'exam', title: 'Week 10 checkpoint', startsOn: day(12), endsOn: day(12) },
    ]);
    await tx.insert(s.studentGoal).values({ academyId: IDS.academyA, studentId: IDS.sam, text: 'Reach B2 in speaking before summer', targetDate: '2027-06-30' });
    await tx.insert(s.studentNote).values({ academyId: IDS.academyA, studentId: IDS.tomas, authorId: IDS.ana, body: 'Mixes up irregular past participles (eaten/ate). Give him the irregular verbs list.' });
    await tx.insert(s.attendance).values([
      { academyId: IDS.academyA, sessionId: IDS.pastSession, studentId: IDS.sam, status: 'present' },
      { academyId: IDS.academyA, sessionId: IDS.pastSession, studentId: IDS.lucia, status: 'present' },
      { academyId: IDS.academyA, sessionId: IDS.pastSession, studentId: IDS.tomas, status: 'late' },
      { academyId: IDS.academyA, sessionId: IDS.pastSession, studentId: IDS.mei, status: 'absent' },
    ]);
    const asg = await tx.insert(s.assignment).values([e1!, e2!, e3!, e4!].map((e) => ({ academyId: IDS.academyA, groupId: IDS.groupB1, exerciseId: e.id, sessionId: IDS.pastSession, dueOn: day(4) }))).returning();
    await tx.insert(s.attempt).values([
      { academyId: IDS.academyA, assignmentId: asg[0]!.id, studentId: IDS.lucia, answer: 1, autoScore: 1 },
      { academyId: IDS.academyA, assignmentId: asg[1]!.id, studentId: IDS.lucia, answer: true, autoScore: 1 },
      { academyId: IDS.academyA, assignmentId: asg[0]!.id, studentId: IDS.tomas, answer: 0, autoScore: 0 },
      { academyId: IDS.academyA, assignmentId: asg[2]!.id, studentId: IDS.tomas, answer: 'I have never ridden a horse. I have never seen snow.', autoScore: null },
    ]);
    // Curriculum version 1 for B1+, assigned to the B1+ group.
    const required = await tx.select({ t: s.curriculumTopic, unit: s.curriculumUnit.title }).from(s.curriculumTopic)
      .innerJoin(s.curriculumUnit, eq(s.curriculumUnit.id, s.curriculumTopic.unitId)).where(eq(s.curriculumUnit.academyId, IDS.academyA));
    const [plan] = await tx.insert(s.curriculumPlan).values({ academyId: IDS.academyA, level: 'B1+', version: 1, notes: 'First published version (demo).', publishedBy: IDS.admin }).returning();
    await tx.insert(s.curriculumPlanTopic).values(required.map((r, i) => ({ planId: plan!.id, topicId: r.t.id, unitTitle: r.unit, topicTitle: r.t.title, objective: r.t.objective, position: i })));
    await tx.update(s.studentGroup).set({ planId: plan!.id }).where(eq(s.studentGroup.id, IDS.groupB1));
  });
  // Freeze what students saw for the class that was already published.
  const snap = await buildSnapshot(db, IDS.academyA, IDS.lesson);
  await db.update(s.classSession).set({ publishedSnapshot: snap }).where(eq(s.classSession.id, IDS.pastSession));
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { db, pool } = createDb(loadEnv().DATABASE_URL);
  seed(db)
    .then((created) => console.log(created ? 'Demo data created.' : 'Demo data already present — nothing to do.'))
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
}
