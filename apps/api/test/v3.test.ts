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

const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://treoo:treoo@localhost:5432/treoo_test';
const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: DB_URL, AI_MODE: 'mock', LOGIN_RATE_LIMIT: '1000' });
const { db, pool } = createDb(DB_URL);
let app: FastifyInstance;
const login = async (email: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: DEMO_PASSWORD } });
  return { headers: { cookie: `treoo_sid=${res.cookies.find((x) => x.name === 'treoo_sid')!.value}` } };
};
const iso = (d: number) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

beforeAll(async () => {
  await db.execute(sql`drop schema if exists treoo cascade`);
  await runMigrations(DB_URL);
  await seed(db);
  app = await buildApp({ env: { ...env, UPLOAD_DIR: await mkdtemp(path.join(os.tmpdir(), 'treoo-v3-')) }, db, ai: createMockAdapter() });
});
afterAll(async () => { await app?.close(); await pool.end(); });

describe('gap fill', () => {
  it('hides answers from students, scores each gap and accepts alternatives', async () => {
    const sam = await login('sam@northbridge.demo');
    const tasks = (await app.inject({ url: '/api/portal/assignments', ...sam })).json();
    const gap = tasks.find((t: { exercise: { type: string } }) => t.exercise.type === 'gap_fill');
    expect(gap.exercise.prompt).not.toContain('have been');
    expect(gap.exercise.prompt).toContain('_____');
    expect(gap.exercise.gaps).toBe(3);
    expect((await app.inject({ method: 'POST', url: `/api/portal/assignments/${gap.id}/attempts`, payload: { answer: ['x'] }, ...sam })).statusCode).toBe(400);
    const r = (await app.inject({ method: 'POST', url: `/api/portal/assignments/${gap.id}/attempts`, payload: { answer: ['Have  been', 'has', 'saw'] }, ...sam })).json();
    expect(r.autoScore).toBe(2);
    const review = (await app.inject({ url: '/api/portal/review', ...sam })).json();
    expect(review.some((x: { assignmentId: string; prompt: string }) => x.assignmentId === gap.id && !x.prompt.includes('{{'))).toBe(true);
  });

  it('teachers must mark gaps in the prompt', async () => {
    const ana = await login('ana@northbridge.demo');
    const bad = await app.inject({ method: 'POST', url: '/api/exercises', payload: { type: 'gap_fill', prompt: 'No gaps here' }, ...ana });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/exercises', payload: { type: 'gap_fill', prompt: 'I {{went}} home.' }, ...ana });
    expect(ok.json().correctAnswer).toEqual([['went']]);
  });
});

describe('curriculum and coverage', () => {
  it('admins edit the curriculum, teachers link lessons and see coverage for their groups', async () => {
    const olivia = await login('olivia@northbridge.demo');
    const tree = (await app.inject({ url: '/api/curriculum?level=B1%2B', ...olivia })).json();
    expect(tree).toHaveLength(3);
    const created = await app.inject({ method: 'POST', url: '/api/curriculum/units', payload: { level: 'B1+', title: 'Unit 4 — Work', topics: [{ title: 'Job interviews' }] }, ...olivia });
    expect(created.json().position).toBe(3);
    const ana = await login('ana@northbridge.demo');
    expect((await app.inject({ method: 'POST', url: '/api/curriculum/units', payload: { level: 'B1+', title: 'x' }, ...ana })).statusCode).toBe(403);
    const cov = (await app.inject({ url: `/api/curriculum/coverage?groupId=${IDS.groupB1}`, ...ana })).json();
    // The group follows published version 1 (8 topics); the unit added afterwards is not in it.
    expect(cov.taught).toBe(1);
    expect(cov.total).toBe(8);
    expect(cov.plan.version).toBe(1);
    const alex = await login('alex@northbridge.demo');
    expect((await app.inject({ url: `/api/curriculum/coverage?groupId=${IDS.groupB1}`, ...alex })).statusCode).toBe(403);
    const bruno = await login('bruno@westport.demo');
    const l = await app.inject({ method: 'POST', url: '/api/lessons', payload: { title: 'x', curriculumTopicId: tree[0].topics[0].id }, ...bruno });
    expect(l.statusCode).toBe(400);
  });
});

describe('assessments', () => {
  it('records multi-skill evidence and shows students only what is shared', async () => {
    const ana = await login('ana@northbridge.demo');
    const bad = await app.inject({ method: 'POST', url: '/api/assessments', payload: { studentId: IDS.sam, kind: 'quiz', takenOn: iso(0), scores: { reading: { score: 25, max: 20 } } }, ...ana });
    expect(bad.statusCode).toBe(400);
    const priv = await app.inject({ method: 'POST', url: '/api/assessments', payload: { studentId: IDS.sam, kind: 'quiz', takenOn: iso(0), scores: { grammar: { score: 7, max: 10 } }, strengths: 'PRIVATE-QUIZ', sharedWithStudent: false }, ...ana });
    expect(priv.statusCode).toBe(201);
    const list = (await app.inject({ url: `/api/assessments?studentId=${IDS.sam}`, ...ana })).json();
    expect(list).toHaveLength(3);
    const sam = await login('sam@northbridge.demo');
    const mine = await app.inject({ url: '/api/assessments/mine', ...sam });
    expect(mine.json()).toHaveLength(2);
    expect(mine.body).not.toContain('PRIVATE-QUIZ');
    const alex = await login('alex@northbridge.demo');
    expect((await app.inject({ method: 'POST', url: '/api/assessments', payload: { studentId: IDS.tomas, kind: 'quiz', takenOn: iso(0), scores: { grammar: { score: 1, max: 10 } } }, ...alex })).statusCode).toBe(404);
  });
});

describe('calendar, events and goals', () => {
  it('students see classes, due tasks and events, and can sign up within capacity', async () => {
    const sam = await login('sam@northbridge.demo');
    const cal = (await app.inject({ url: `/api/portal/calendar?from=${iso(-7)}&to=${iso(14)}`, ...sam })).json();
    expect(cal.classes.length).toBeGreaterThan(0);
    expect(cal.due.length).toBeGreaterThan(0);
    const film = cal.events.find((e: { title: string }) => e.title === 'English film night');
    expect(film.signedUp).toBe(false);
    expect((await app.inject({ method: 'POST', url: `/api/portal/events/${film.id}/signup`, ...sam })).statusCode).toBe(201);
    const after = (await app.inject({ url: `/api/portal/calendar?from=${iso(-7)}&to=${iso(14)}`, ...sam })).json();
    expect(after.events.find((e: { id: string }) => e.id === film.id)).toMatchObject({ signedUp: true, signups: 1 });
    const exam = after.events.find((e: { kind: string }) => e.kind === 'exam');
    expect((await app.inject({ method: 'POST', url: `/api/portal/events/${exam.id}/signup`, ...sam })).statusCode).toBe(404);
    const noah = await login('noah@westport.demo');
    expect((await app.inject({ method: 'POST', url: `/api/portal/events/${film.id}/signup`, ...noah })).statusCode).toBe(404);
  });

  it('students manage their own goals only', async () => {
    const sam = await login('sam@northbridge.demo');
    const g = (await app.inject({ method: 'POST', url: '/api/portal/goals', payload: { text: 'Read one graded reader a month' }, ...sam })).json();
    expect((await app.inject({ method: 'PUT', url: `/api/portal/goals/${g.id}`, payload: { done: true }, ...sam })).json().doneAt).toBeTruthy();
    const lucia = await login('lucia@northbridge.demo');
    expect((await app.inject({ method: 'PUT', url: `/api/portal/goals/${g.id}`, payload: { done: false }, ...lucia })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/portal/goals', ...sam })).json()).toHaveLength(2);
  });
});

describe('library, sites and active students', () => {
  it('students reach only material shared with their published classes', async () => {
    const sam = await login('sam@northbridge.demo');
    const lib = (await app.inject({ url: '/api/portal/library', ...sam })).json();
    expect(lib).toHaveLength(1);
    expect(lib[0].text).toContain('Present Perfect');
    const noah = await login('noah@westport.demo');
    expect((await app.inject({ url: '/api/portal/library', ...noah })).json()).toEqual([]);
  });

  it('admins manage sites, filter progress and get a proposed active-student count', async () => {
    const olivia = await login('olivia@northbridge.demo');
    const sites = (await app.inject({ url: '/api/academy/sites', ...olivia })).json();
    expect(sites).toHaveLength(2);
    const filtered = (await app.inject({ url: `/api/progress/overview?siteId=${sites[0].id}`, ...olivia })).json();
    expect(filtered.every((g: { siteName: string }) => g.siteName === sites[0].name)).toBe(true);
    const month = new Date().toISOString().slice(0, 7);
    const report = (await app.inject({ url: `/api/academy/billing/active-students?month=${month}`, ...olivia })).json();
    expect(report.active).toBeGreaterThan(0);
    expect(report.rule).toContain('proposal');
    const csv = await app.inject({ url: `/api/academy/billing/active-students?month=${month}&format=csv`, ...olivia });
    expect(csv.headers['content-type']).toContain('text/csv');
    const ana = await login('ana@northbridge.demo');
    expect((await app.inject({ url: `/api/academy/billing/active-students?month=${month}`, ...ana })).statusCode).toBe(403);
  });
});
