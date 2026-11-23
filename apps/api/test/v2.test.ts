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

beforeAll(async () => {
  await db.execute(sql`drop schema if exists treoo cascade`);
  await runMigrations(DB_URL);
  await seed(db);
  app = await buildApp({ env: { ...env, UPLOAD_DIR: await mkdtemp(path.join(os.tmpdir(), 'treoo-v2-')) }, db, ai: createMockAdapter() });
});
afterAll(async () => { await app?.close(); await pool.end(); });

describe('teacher Today screen', () => {
  it('shows today, things to publish and mark, and students needing attention — only for my groups', async () => {
    const ana = await login('ana@northbridge.demo');
    const d = (await app.inject({ url: '/api/dashboard', ...ana })).json();
    expect(d.classes.some((c: { id: string }) => c.id === IDS.todaySession)).toBe(true);
    expect(d.toPublish).toHaveLength(1);
    expect(d.toMark[0]).toMatchObject({ pending: 1 });
    const mei = d.attention.find((a: { displayName: string }) => a.displayName === 'Mei Tanaka');
    expect(mei.reasons[0]).toContain('2 absences');
    const alex = await login('alex@northbridge.demo');
    const da = (await app.inject({ url: '/api/dashboard', ...alex })).json();
    // Alex only sees his own B2 class today, and none of Ana's answers to mark.
    expect(da.classes.map((c: { groupName: string }) => c.groupName)).toEqual(['B2 Conversation — Morning']);
    expect(da.toMark).toHaveLength(0);
    const sam = await login('sam@northbridge.demo');
    expect((await app.inject({ url: '/api/dashboard', ...sam })).statusCode).toBe(403);
  });
});

describe('vocabulary', () => {
  it('teacher edits the list keeping ids; AI suggestions are not saved', async () => {
    const ana = await login('ana@northbridge.demo');
    const before = (await app.inject({ url: `/api/lessons/${IDS.lesson}/vocab`, ...ana })).json();
    expect(before).toHaveLength(6);
    const items = [{ ...before[1], meaning: 'at any time' }, before[0], { term: 'so far', meaning: 'until now' }];
    const after = (await app.inject({ method: 'PUT', url: `/api/lessons/${IDS.lesson}/vocab`, payload: { items }, ...ana })).json();
    expect(after.map((v: { term: string }) => v.term)).toEqual(['ever', 'have been to', 'so far']);
    expect(after[0].id).toBe(before[1].id);
    const sug = await app.inject({ method: 'POST', url: '/api/ai/vocab', payload: { lessonId: IDS.lesson }, ...ana });
    expect(sug.json().origin).toBe('mock');
    expect((await app.inject({ url: `/api/lessons/${IDS.lesson}/vocab`, ...ana })).json()).toHaveLength(3);
  });

  it('others cannot change the vocabulary', async () => {
    const olivia = await login('olivia@northbridge.demo');
    expect((await app.inject({ method: 'PUT', url: `/api/lessons/${IDS.lesson}/vocab`, payload: { items: [] }, ...olivia })).statusCode).toBe(403);
    const bruno = await login('bruno@westport.demo');
    expect((await app.inject({ url: `/api/lessons/${IDS.lesson}/vocab`, ...bruno })).statusCode).toBe(404);
  });

  it('students review published words with spaced repetition', async () => {
    const sam = await login('sam@northbridge.demo');
    const words = (await app.inject({ url: '/api/portal/vocab', ...sam })).json();
    expect(words.length).toBe(3);
    expect(words.every((w: { due: boolean }) => w.due)).toBe(true);
    const w = words[0];
    const r1 = (await app.inject({ method: 'POST', url: `/api/portal/vocab/${w.id}/review`, payload: { result: 'known' }, ...sam })).json();
    expect(r1.box).toBe(1);
    const r2 = (await app.inject({ method: 'POST', url: `/api/portal/vocab/${w.id}/review`, payload: { result: 'known' }, ...sam })).json();
    expect(r2.box).toBe(2);
    const r3 = (await app.inject({ method: 'POST', url: `/api/portal/vocab/${w.id}/review`, payload: { result: 'again' }, ...sam })).json();
    expect(r3.box).toBe(1);
    const after = (await app.inject({ url: '/api/portal/vocab', ...sam })).json();
    expect(after.find((x: { id: string }) => x.id === w.id).due).toBe(false);
    const noah = await login('noah@westport.demo');
    expect((await app.inject({ method: 'POST', url: `/api/portal/vocab/${w.id}/review`, payload: { result: 'known' }, ...noah })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/portal/vocab', ...noah })).json()).toEqual([]);
  });
});

describe('student profile and private notes', () => {
  it('teachers see only their own students; notes never reach the student', async () => {
    const ana = await login('ana@northbridge.demo');
    const p = (await app.inject({ url: `/api/students/${IDS.tomas}`, ...ana })).json();
    expect(p.student.displayName).toBe('Tomás Novak');
    expect(p.notes[0].body).toContain('irregular');
    expect(p.attendance.length).toBeGreaterThan(0);
    const n = await app.inject({ method: 'POST', url: `/api/students/${IDS.tomas}/notes`, payload: { body: 'Much better today.' }, ...ana });
    expect(n.statusCode).toBe(201);
    const alex = await login('alex@northbridge.demo');
    expect((await app.inject({ url: `/api/students/${IDS.tomas}`, ...alex })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/students/${IDS.sam}`, ...alex })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/students/${IDS.tomas}/notes/${n.json().id}`, ...(await login('olivia@northbridge.demo')) })).statusCode).toBe(403);
    const tomas = await login('tomas@northbridge.demo');
    expect((await app.inject({ url: `/api/students/${IDS.tomas}`, ...tomas })).statusCode).toBe(403);
    for (const url of ['/api/portal/diary', '/api/portal/assignments', '/api/portal/progress']) {
      expect((await app.inject({ url, ...tomas })).body).not.toContain('irregular past participles');
    }
  });
});

describe('lesson reuse', () => {
  it('duplicates a lesson with activities, exercises and vocabulary as a new draft', async () => {
    const ana = await login('ana@northbridge.demo');
    const r = await app.inject({ method: 'POST', url: `/api/lessons/${IDS.lesson}/duplicate`, ...ana });
    expect(r.statusCode).toBe(201);
    const copy = (await app.inject({ url: `/api/lessons/${r.json().id}`, ...ana })).json();
    expect(copy).toMatchObject({ title: 'Present Perfect: life experiences (copy)', status: 'draft', revision: 1 });
    expect(copy.activities).toHaveLength(4);
    expect(copy.exercises).toHaveLength(4);
    expect(copy.vocab).toHaveLength(3);
    const alex = await login('alex@northbridge.demo');
    expect((await app.inject({ method: 'POST', url: `/api/lessons/${IDS.lesson}/duplicate`, ...alex })).statusCode).toBe(404);
  });
});
