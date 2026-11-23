import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockAdapter } from '../src/ai/adapter.js';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { DEMO_PASSWORD, IDS, seed } from '../src/db/seed.js';
import { loadEnv } from '../src/env.js';
import { localToday } from '../src/lib/schedule.js';

const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://treoo:treoo@localhost:5432/treoo_test';
const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: DB_URL, AI_MODE: 'mock', LOGIN_RATE_LIMIT: '1000' });
const { db, pool } = createDb(DB_URL);
let app: FastifyInstance;
const login = async (email: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: DEMO_PASSWORD } });
  return { headers: { cookie: `treoo_sid=${res.cookies.find((x) => x.name === 'treoo_sid')!.value}` } };
};
const iso = (d: number) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const ROOM1 = '81000000-0000-4000-8000-000000000001';

beforeAll(async () => {
  await db.execute(sql`drop schema if exists treoo cascade`);
  await runMigrations(DB_URL);
  await seed(db);
  app = await buildApp({ env: { ...env, UPLOAD_DIR: await mkdtemp(path.join(os.tmpdir(), 'treoo-en-')) }, db, ai: createMockAdapter() });
});
afterAll(async () => { await app?.close(); await pool.end(); });

describe('enabler 1 — published content is frozen', () => {
  it('editing the lesson after publishing does not change what students see until the teacher republishes', async () => {
    const ana = await login('ana@northbridge.demo');
    const l = (await app.inject({ url: `/api/lessons/${IDS.lesson}`, ...ana })).json();
    await app.inject({ method: 'PUT', url: `/api/lessons/${IDS.lesson}`, payload: { title: 'EDITED LATER', curriculumTopicId: l.curriculumTopicId, activities: [{ title: 'Brand new activity' }], expectedRevision: l.revision }, ...ana });
    const sam = await login('sam@northbridge.demo');
    const before = (await app.inject({ url: `/api/portal/sessions/${IDS.pastSession}`, ...sam })).json();
    expect(before.lessonTitle).toBe('Present Perfect: life experiences');
    expect(before.activities).toHaveLength(4);
    expect(before.vocab.length).toBeGreaterThan(0);
    const diary = (await app.inject({ url: '/api/portal/diary', ...sam })).body;
    expect(diary).not.toContain('EDITED LATER');
    const pub = (await app.inject({ method: 'POST', url: `/api/sessions/${IDS.pastSession}/publish`, ...ana })).json();
    expect(pub.publishedSnapshot.lessonRevision).toBe(l.revision + 1);
    const after = (await app.inject({ url: `/api/portal/sessions/${IDS.pastSession}`, ...sam })).json();
    expect(after.lessonTitle).toBe('EDITED LATER');
    expect(after.activities.map((a: { title: string }) => a.title)).toEqual(['Brand new activity']);
  });

  it('answered exercises cannot be edited or deleted; a new version leaves old answers intact', async () => {
    const ana = await login('ana@northbridge.demo');
    const exs = (await app.inject({ url: `/api/exercises?lessonId=${IDS.lesson}`, ...ana })).json();
    const answered = exs.find((e: { type: string; attempts: number }) => e.type === 'single_choice' && e.attempts > 0);
    const body = { type: 'single_choice', prompt: answered.prompt, options: answered.options, correctAnswer: 0 };
    const put = await app.inject({ method: 'PUT', url: `/api/exercises/${answered.id}`, payload: body, ...ana });
    expect(put.statusCode).toBe(409);
    expect(put.json().error.code).toBe('exercise_has_attempts');
    expect((await app.inject({ method: 'DELETE', url: `/api/exercises/${answered.id}`, ...ana })).statusCode).toBe(409);
    const nv = await app.inject({ method: 'POST', url: `/api/exercises/${answered.id}/new-version`, payload: body, ...ana });
    expect(nv.statusCode).toBe(201);
    expect(nv.json()).toMatchObject({ attempts: 0, replaces: answered.id, correctAnswer: 0 });
    const original = (await app.inject({ url: `/api/exercises?lessonId=${IDS.lesson}`, ...ana })).json().find((e: { id: string }) => e.id === answered.id);
    expect(original.correctAnswer).toBe(1);
    const fresh = await app.inject({ method: 'POST', url: '/api/exercises', payload: { type: 'true_false', prompt: 'Editable?', correctAnswer: true }, ...ana });
    expect((await app.inject({ method: 'PUT', url: `/api/exercises/${fresh.json().id}`, payload: { type: 'true_false', prompt: 'Still editable', correctAnswer: false }, ...ana })).statusCode).toBe(200);
  });
});

describe('enabler 2 — time model', () => {
  it('validates times, detects teacher and room clashes with half-open intervals, and allows a confirmed override', async () => {
    const ana = await login('ana@northbridge.demo');
    const base = { groupId: IDS.groupB1, scheduledOn: iso(0), roomId: ROOM1 };
    expect((await app.inject({ method: 'POST', url: '/api/sessions', payload: { ...base, startTime: '11:00', endTime: '10:00' }, ...ana })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/sessions', payload: { ...base, startTime: '11:00' }, ...ana })).statusCode).toBe(400);
    const clash = await app.inject({ method: 'POST', url: '/api/sessions', payload: { ...base, startTime: '10:30', endTime: '11:30' }, ...ana });
    expect(clash.statusCode).toBe(409);
    const reasons = clash.json().error.details.clashes.map((x: { reason: string }) => x.reason).sort();
    expect(reasons).toEqual(['room', 'teacher']);
    const adjacent = await app.inject({ method: 'POST', url: '/api/sessions', payload: { ...base, roomId: null, startTime: '13:00', endTime: '14:00' }, ...ana });
    expect(adjacent.statusCode).toBe(201);
    const forced = await app.inject({ method: 'POST', url: '/api/sessions', payload: { ...base, startTime: '10:30', endTime: '11:30', confirmClash: true }, ...ana });
    expect(forced.statusCode).toBe(201);
  });

  it('cancelled classes take no attendance, cannot be published and leave the attendance rate alone', async () => {
    const ana = await login('ana@northbridge.demo');
    const s = (await app.inject({ method: 'POST', url: '/api/sessions', payload: { groupId: IDS.groupB1, scheduledOn: iso(2), startTime: '09:00', endTime: '11:00' }, ...ana })).json();
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/cancel`, payload: { reason: '' }, ...ana })).statusCode).toBe(400);
    const c = (await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/cancel`, payload: { reason: 'Teacher training day' }, ...ana })).json();
    expect(c.status).toBe('cancelled');
    expect((await app.inject({ method: 'PUT', url: `/api/sessions/${s.id}/attendance`, payload: { records: [{ studentId: IDS.sam, status: 'absent' }] }, ...ana })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/publish`, ...ana })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${IDS.pastSession}/cancel`, payload: { reason: 'x' }, ...ana })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/reinstate`, payload: {}, ...ana })).json().status).toBe('planned');
  });

  it('attendance rate excludes excused (A01 rule) and the academy time zone drives "today"', async () => {
    const olivia = await login('olivia@northbridge.demo');
    const rate = async () => (await app.inject({ url: '/api/progress/overview', ...olivia })).json().find((x: { id: string }) => x.id === IDS.groupB1).attendanceRate;
    // Seed: (2 present + 1 late) + 3 present = 6 attended, 2 absent → 6 / 8 = 75%.
    expect(await rate()).toBe(75);
    // An excused absence must not lower the rate (the previous formula would give 6 / 9 = 67%).
    const ana = await login('ana@northbridge.demo');
    const s = (await app.inject({ method: 'POST', url: '/api/sessions', payload: { groupId: IDS.groupB1, scheduledOn: iso(-1) }, ...ana })).json();
    await app.inject({ method: 'PUT', url: `/api/sessions/${s.id}/attendance`, payload: { records: [{ studentId: IDS.sam, status: 'excused' }] }, ...ana });
    expect(await rate()).toBe(75);
    expect((await app.inject({ method: 'PUT', url: '/api/academy/settings', payload: { timezone: 'Mars/Olympus' }, ...olivia })).statusCode).toBe(400);
    const set = (await app.inject({ method: 'PUT', url: '/api/academy/settings', payload: { timezone: 'Pacific/Auckland' }, ...olivia })).json();
    expect(set.timezone).toBe('Pacific/Auckland');
    const d = (await app.inject({ url: '/api/dashboard', ...olivia })).json();
    expect(d.today).toBe(localToday('Pacific/Auckland'));
    await app.inject({ method: 'PUT', url: '/api/academy/settings', payload: { timezone: 'Europe/Dublin' }, ...olivia });
  });
});

describe('enabler 3 — curriculum versioning', () => {
  it('removing a topic archives it; lessons keep the link and published versions do not change', async () => {
    const olivia = await login('olivia@northbridge.demo');
    const units = (await app.inject({ url: '/api/curriculum?level=B1%2B', ...olivia })).json();
    const u1 = units[0];
    const before = (await app.inject({ url: `/api/curriculum/coverage?groupId=${IDS.groupB1}`, ...olivia })).json();
    expect(before.plan.version).toBe(1);
    // Remove "Present Perfect" (linked to the demo lesson) and mark another topic optional.
    const topics = u1.topics.slice(1).map((t: { id: string; title: string }, i: number) => ({ id: t.id, title: t.title, required: i !== 0 }));
    await app.inject({ method: 'PUT', url: `/api/curriculum/units/${u1.id}`, payload: { level: 'B1+', title: u1.title, topics }, ...olivia });
    const ana = await login('ana@northbridge.demo');
    expect((await app.inject({ url: `/api/lessons/${IDS.lesson}`, ...ana })).json().curriculumTopicId).toBe(u1.topics[0].id);
    const live = (await app.inject({ url: '/api/curriculum?level=B1%2B', ...olivia })).json();
    expect(live[0].topics.map((t: { id: string }) => t.id)).not.toContain(u1.topics[0].id);
    const archived = (await app.inject({ url: '/api/curriculum?level=B1%2B&includeArchived=1', ...olivia })).json();
    expect(archived[0].topics.find((t: { id: string }) => t.id === u1.topics[0].id).archivedAt).toBeTruthy();
    const after = (await app.inject({ url: `/api/curriculum/coverage?groupId=${IDS.groupB1}`, ...olivia })).json();
    expect(after.total).toBe(before.total);
    expect(after.taught).toBe(before.taught);
  });

  it('publishes a new version with only required, active topics and assigns it explicitly', async () => {
    const olivia = await login('olivia@northbridge.demo');
    const v2 = (await app.inject({ method: 'POST', url: '/api/curriculum/plans', payload: { level: 'B1+', notes: 'Removed Present Perfect' }, ...olivia })).json();
    expect(v2.version).toBe(2);
    expect(v2.topics).toBe(6);
    const plans = (await app.inject({ url: '/api/curriculum/plans?level=B1%2B', ...olivia })).json();
    expect(plans.map((p: { version: number }) => p.version)).toEqual([2, 1]);
    expect((await app.inject({ method: 'POST', url: '/api/curriculum/plans', payload: { level: 'Z9' }, ...olivia })).statusCode).toBe(400);
    await app.inject({ method: 'PUT', url: `/api/academy/groups/${IDS.groupB1}/plan`, payload: { planId: v2.id }, ...olivia });
    const cov = (await app.inject({ url: `/api/curriculum/coverage?groupId=${IDS.groupB1}`, ...olivia })).json();
    expect(cov).toMatchObject({ plan: { version: 2 }, total: 6, taught: 0 });
    const ana = await login('ana@northbridge.demo');
    expect((await app.inject({ method: 'POST', url: '/api/curriculum/plans', payload: { level: 'B1+' }, ...ana })).statusCode).toBe(403);
    const bruno = await login('bruno@westport.demo');
    expect((await app.inject({ url: `/api/curriculum/plans/${v2.id}`, ...bruno })).statusCode).toBe(404);
  });
});
