import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createManualAdapter, createMockAdapter } from '../src/ai/adapter.js';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { DEMO_PASSWORD, IDS, seed } from '../src/db/seed.js';
import { loadEnv } from '../src/env.js';

const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://treoo:treoo@localhost:5432/treoo_test';
const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: DB_URL, AI_MODE: 'mock', LOGIN_RATE_LIMIT: '1000' });
const { db, pool } = createDb(DB_URL);
let app: FastifyInstance;

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function login(email: string, a = app) {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: DEMO_PASSWORD } });
  expect(res.statusCode).toBe(200);
  const c = res.cookies.find((x) => x.name === 'treoo_sid')!;
  return { cookie: `treoo_sid=${c.value}` };
}
const as = (h: { cookie: string }, extra: Record<string, string> = {}) => ({ headers: { ...h, ...extra } });

beforeAll(async () => {
  await db.execute(sql`drop schema if exists treoo cascade`);
  await runMigrations(DB_URL);
  await seed(db);
  app = await buildApp({ env: { ...env, UPLOAD_DIR: await mkdtemp(path.join(os.tmpdir(), 'treoo-up-')) }, db, ai: createMockAdapter() });
});
afterAll(async () => { await app?.close(); await pool.end(); });

describe('authentication', () => {
  it('rejects wrong passwords and anonymous access', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ana@northbridge.demo', password: 'nope' } });
    expect(bad.statusCode).toBe(401);
    expect((await app.inject({ url: '/api/lessons' })).statusCode).toBe(401);
  });
  it('only lets people switch to academies they belong to', async () => {
    const bruno = await login('bruno@westport.demo');
    const res = await app.inject({ method: 'POST', url: '/api/auth/academy', payload: { academyId: IDS.academyA }, ...as(bruno) });
    expect(res.statusCode).toBe(403);
  });
  it('logout invalidates the server session', async () => {
    const s = await login('sam@northbridge.demo');
    await app.inject({ method: 'POST', url: '/api/auth/logout', ...as(s) });
    expect((await app.inject({ url: '/api/auth/me', ...as(s) })).statusCode).toBe(401);
  });
});

describe('cut A — manual lesson preparation (DEC-A-002)', () => {
  let ana: { cookie: string };
  beforeAll(async () => { ana = await login('ana@northbridge.demo'); });

  it('saves a draft with only a title and zero activities', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/lessons', payload: { title: '  Just a title  ' }, ...as(ana) });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ title: 'Just a title', status: 'draft', revision: 1, activities: [] });
  });

  it('validates title and durations', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/lessons', payload: { title: '   ' }, ...as(ana) })).statusCode).toBe(400);
    for (const d of [0, -5, 1e9]) {
      const r = await app.inject({ method: 'POST', url: '/api/lessons', payload: { title: 'X', activities: [{ durationMinutes: d }] }, ...as(ana) });
      expect(r.statusCode).toBe(400);
    }
  });

  it('create → save → reopen keeps activities, fractional and unknown durations', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/lessons', ...as(ana), payload: {
      title: 'Second conditional', topic: 'Conditionals',
      activities: [{ title: 'Warm-up', durationMinutes: 10 }, { title: 'Drill', durationMinutes: 7.5 }, { title: 'Open speaking', durationMinutes: null }],
    } });
    const l = created.json();
    expect(l.totalMinutes).toBe(17.5);
    expect(l.activitiesWithoutDuration).toBe(1);
    const saved = await app.inject({ method: 'PUT', url: `/api/lessons/${l.id}`, ...as(ana), payload: {
      title: 'Second conditional — v2', topic: 'Conditionals', expectedRevision: 1,
      activities: [{ title: 'Drill', durationMinutes: 7.5 }, { title: 'Warm-up', durationMinutes: 12 }],
    } });
    expect(saved.statusCode).toBe(200);
    const reopened = (await app.inject({ url: `/api/lessons/${l.id}`, ...as(ana) })).json();
    expect(reopened.revision).toBe(2);
    expect(reopened.activities.map((a: { title: string }) => a.title)).toEqual(['Drill', 'Warm-up']);
    expect(reopened.status).toBe('draft');
  });

  it('never silently overwrites a newer revision (409 with current version)', async () => {
    const l = (await app.inject({ method: 'POST', url: '/api/lessons', payload: { title: 'Concurrent' }, ...as(ana) })).json();
    const first = await app.inject({ method: 'PUT', url: `/api/lessons/${l.id}`, payload: { title: 'Tab one', expectedRevision: 1 }, ...as(ana) });
    expect(first.statusCode).toBe(200);
    const stale = await app.inject({ method: 'PUT', url: `/api/lessons/${l.id}`, payload: { title: 'Tab two', expectedRevision: 1 }, ...as(ana) });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.details.current.title).toBe('Tab one');
    expect((await app.inject({ url: `/api/lessons/${l.id}`, ...as(ana) })).json().title).toBe('Tab one');
  });

  it('replays retries with the same Idempotency-Key and rejects key reuse for a different request', async () => {
    const key = { 'idempotency-key': 'create-test-key-0001' };
    const a = await app.inject({ method: 'POST', url: '/api/lessons', payload: { title: 'Retry me' }, ...as(ana, key) });
    const b = await app.inject({ method: 'POST', url: '/api/lessons', payload: { title: 'Retry me' }, ...as(ana, key) });
    expect(b.statusCode).toBe(201);
    expect(b.json().id).toBe(a.json().id);
    expect(b.headers['idempotent-replayed']).toBe('true');
    const list = (await app.inject({ url: '/api/lessons?q=Retry%20me', ...as(ana) })).json();
    expect(list).toHaveLength(1);
    const reuse = await app.inject({ method: 'POST', url: '/api/lessons', payload: { title: 'Something else' }, ...as(ana, key) });
    expect(reuse.statusCode).toBe(422);
  });

  it('searches own lessons by title or topic', async () => {
    const list = (await app.inject({ url: '/api/lessons?q=present', ...as(ana) })).json();
    expect(list.map((l: { id: string }) => l.id)).toContain(IDS.lesson);
  });
});

describe('multi-academy isolation (TD-02)', () => {
  it('a teacher of another academy cannot read, list or change academy A lessons', async () => {
    const bruno = await login('bruno@westport.demo');
    expect((await app.inject({ url: `/api/lessons/${IDS.lesson}`, ...as(bruno) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/lessons/${IDS.lesson}`, payload: { title: 'Hijack', expectedRevision: 1 }, ...as(bruno) })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/lessons', ...as(bruno) })).json()).toEqual([]);
    expect((await app.inject({ url: `/api/materials/${IDS.material}/original`, ...as(bruno) })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/groups/${IDS.groupB1}`, ...as(bruno) })).statusCode).toBe(404);
  });

  it('ignores academy ids sent in the body', async () => {
    const bruno = await login('bruno@westport.demo');
    const r = await app.inject({ method: 'POST', url: '/api/lessons', payload: { title: 'Mine', academyId: IDS.academyA }, ...as(bruno) });
    expect(r.json().academyId).toBe(IDS.academyB);
  });

  it('the same person sees only the active academy', async () => {
    const ana = await login('ana@northbridge.demo');
    await app.inject({ method: 'POST', url: '/api/auth/academy', payload: { academyId: IDS.academyB }, ...as(ana) });
    expect((await app.inject({ url: `/api/lessons/${IDS.lesson}`, ...as(ana) })).statusCode).toBe(404);
    await app.inject({ method: 'POST', url: '/api/auth/academy', payload: { academyId: IDS.academyA }, ...as(ana) });
    expect((await app.inject({ url: `/api/lessons/${IDS.lesson}`, ...as(ana) })).statusCode).toBe(200);
  });

  it('teachers see only their own lessons; admins can review but not edit them', async () => {
    const alex = await login('alex@northbridge.demo');
    expect((await app.inject({ url: `/api/lessons/${IDS.lesson}`, ...as(alex) })).statusCode).toBe(404);
    const olivia = await login('olivia@northbridge.demo');
    const view = await app.inject({ url: `/api/lessons/${IDS.lesson}`, ...as(olivia) });
    expect(view.statusCode).toBe(200);
    expect(view.json().canEdit).toBe(false);
    expect((await app.inject({ method: 'PUT', url: `/api/lessons/${IDS.lesson}`, payload: { title: 'x', expectedRevision: 1 }, ...as(olivia) })).statusCode).toBe(403);
  });

  it('material stays private to its owner within the academy', async () => {
    const alex = await login('alex@northbridge.demo');
    expect((await app.inject({ url: `/api/materials/${IDS.material}`, ...as(alex) })).statusCode).toBe(404);
    const r = await app.inject({ method: 'POST', url: '/api/lessons', payload: { title: 'Borrow', materialId: IDS.material }, ...as(alex) });
    expect(r.statusCode).toBe(400);
  });

  it('students cannot reach teacher preparation', async () => {
    const sam = await login('sam@northbridge.demo');
    expect((await app.inject({ url: '/api/lessons', ...as(sam) })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/materials/${IDS.material}`, ...as(sam) })).statusCode).toBe(403);
  });
});

describe('materials and AI assistance', () => {
  const multipart = (filename: string, content: Buffer, title: string) => {
    const b = '----treoo';
    const body = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
      content, Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
  };

  it('uploads a photo, keeps the original, extracts (simulated) and drafts a lesson', async () => {
    const ana = await login('ana@northbridge.demo');
    const up = multipart('page.png', PNG_1PX, 'Page 12');
    const res = await app.inject({ method: 'POST', url: '/api/materials', payload: up.payload, headers: { ...up.headers, ...ana } });
    expect(res.statusCode).toBe(201);
    const m = res.json();
    const orig = await app.inject({ url: `/api/materials/${m.id}/original`, ...as(ana) });
    expect(orig.rawPayload.equals(PNG_1PX)).toBe(true);
    const ex = await app.inject({ method: 'POST', url: `/api/materials/${m.id}/extract`, ...as(ana) });
    expect(ex.json().extractionStatus).toBe('mock');
    const edited = await app.inject({ method: 'PUT', url: `/api/materials/${m.id}`, payload: { title: 'Page 12', extractedText: 'Corrected text about the past simple.' }, ...as(ana) });
    expect(edited.json().extractionStatus).toBe('manual');
    const draft = await app.inject({ method: 'POST', url: '/api/ai/draft', payload: { materialId: m.id, totalMinutes: 50 }, ...as(ana) });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().origin).toBe('mock');
    // A draft is never stored until the teacher saves it.
    const count = (await app.inject({ url: '/api/lessons?q=simulated', ...as(ana) })).json();
    expect(count).toHaveLength(0);
  });

  it('rejects files that are not images regardless of the declared type', async () => {
    const ana = await login('ana@northbridge.demo');
    const up = multipart('evil.png', Buffer.from('<script>alert(1)</script>'), 'Not an image');
    const res = await app.inject({ method: 'POST', url: '/api/materials', payload: up.payload, headers: { ...up.headers, ...ana } });
    expect(res.statusCode).toBe(415);
  });

  it('keeps the manual route working when AI is off', async () => {
    const manualApp = await buildApp({ env, db, ai: createManualAdapter() });
    const ana = await login('ana@northbridge.demo', manualApp);
    const d = await manualApp.inject({ method: 'POST', url: '/api/ai/draft', payload: { sourceText: 'Some text' }, ...as(ana) });
    expect(d.statusCode).toBe(503);
    const l = await manualApp.inject({ method: 'POST', url: '/api/lessons', payload: { title: 'Manual only' }, ...as(ana) });
    expect(l.statusCode).toBe(201);
    await manualApp.close();
  });
});

describe('classroom, diary and practice', () => {
  it('delivers, publishes and exposes only shared content to enrolled students', async () => {
    const ana = await login('ana@northbridge.demo');
    const s = (await app.inject({ method: 'POST', url: '/api/sessions', payload: { groupId: IDS.groupB1, lessonId: IDS.lesson, scheduledOn: '2026-11-10' }, ...as(ana) })).json();
    const att = await app.inject({ method: 'PUT', url: `/api/sessions/${s.id}/attendance`, payload: { records: [{ studentId: IDS.sam, status: 'present' }] }, ...as(ana) });
    expect(att.statusCode).toBe(200);
    const outsider = await app.inject({ method: 'PUT', url: `/api/sessions/${s.id}/attendance`, payload: { records: [{ studentId: IDS.noah, status: 'present' }] }, ...as(ana) });
    expect(outsider.statusCode).toBe(400);
    await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/deliver`, payload: { sharedNotes: 'Shared summary', privateNotes: 'SECRET teacher note', board: `data:image/png;base64,${PNG_1PX.toString('base64')}`, shareBoard: true }, ...as(ana) });

    const sam = await login('sam@northbridge.demo');
    const before = (await app.inject({ url: '/api/portal/diary', ...as(sam) })).json();
    expect(before.find((x: { id: string }) => x.id === s.id)).toBeUndefined();

    await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/publish`, ...as(ana) });
    const detail = await app.inject({ url: `/api/portal/sessions/${s.id}`, ...as(sam) });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('Shared summary');
    expect(detail.body).not.toContain('SECRET');
    expect(detail.json().myAttendance).toBe('present');
    expect((await app.inject({ url: `/api/sessions/${s.id}/board`, ...as(sam) })).statusCode).toBe(200);

    const noah = await login('noah@westport.demo');
    expect((await app.inject({ url: `/api/portal/sessions/${s.id}`, ...as(noah) })).statusCode).toBe(404);
    // Alex teaches a different group: cannot manage Ana's class.
    const alex = await login('alex@northbridge.demo');
    expect((await app.inject({ url: `/api/sessions/${s.id}`, ...as(alex) })).statusCode).toBe(403);
  });

  it('hides the answer key until a student attempts, auto-scores, limits attempts and allows teacher review', async () => {
    const sam = await login('sam@northbridge.demo');
    const tasks = (await app.inject({ url: '/api/portal/assignments', ...as(sam) })).json();
    const choice = tasks.find((t: { exercise: { type: string } }) => t.exercise.type === 'single_choice');
    expect(choice.exercise.correctAnswer).toBeUndefined();
    const wrong = await app.inject({ method: 'POST', url: `/api/portal/assignments/${choice.id}/attempts`, payload: { answer: 0 }, ...as(sam) });
    expect(wrong.json()).toMatchObject({ autoScore: 0, correctAnswer: 1 });
    await app.inject({ method: 'POST', url: `/api/portal/assignments/${choice.id}/attempts`, payload: { answer: 1 }, ...as(sam) });
    await app.inject({ method: 'POST', url: `/api/portal/assignments/${choice.id}/attempts`, payload: { answer: 1 }, ...as(sam) });
    const fourth = await app.inject({ method: 'POST', url: `/api/portal/assignments/${choice.id}/attempts`, payload: { answer: 1 }, ...as(sam) });
    expect(fourth.statusCode).toBe(400);
    const invalid = await app.inject({ method: 'POST', url: `/api/portal/assignments/${choice.id}/attempts`, payload: { answer: 99 }, ...as(sam) });
    expect(invalid.statusCode).toBe(400);

    const open = tasks.find((t: { exercise: { type: string } }) => t.exercise.type === 'short_answer');
    const a = (await app.inject({ method: 'POST', url: `/api/portal/assignments/${open.id}/attempts`, payload: { answer: 'I have never flown.' }, ...as(sam) })).json();
    expect(a.autoScore).toBeNull();
    const ana = await login('ana@northbridge.demo');
    const review = await app.inject({ method: 'PUT', url: `/api/attempts/${a.id}/review`, payload: { teacherScore: 2, feedback: 'Great — try a second sentence too.' }, ...as(ana) });
    expect(review.statusCode).toBe(200);
    const tooHigh = await app.inject({ method: 'PUT', url: `/api/attempts/${a.id}/review`, payload: { teacherScore: 5, feedback: null }, ...as(ana) });
    expect(tooHigh.statusCode).toBe(400);
    const progress = (await app.inject({ url: '/api/portal/progress', ...as(sam) })).json();
    expect(progress.topics[0]).toMatchObject({ topic: 'Present Perfect' });
  });

  it('assigns lesson exercises to a group, only from the same academy', async () => {
    const ana = await login('ana@northbridge.demo');
    const ex = (await app.inject({ url: `/api/exercises?lessonId=${IDS.lesson}`, ...as(ana) })).json();
    const r = await app.inject({ method: 'POST', url: '/api/assignments', payload: { groupId: IDS.groupB1, exerciseIds: [ex[0].id, ex[1].id], dueOn: '2026-12-01' }, ...as(ana) });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toHaveLength(2);
    const bruno = await login('bruno@westport.demo');
    const cross = await app.inject({ method: 'POST', url: '/api/assignments', payload: { groupId: IDS.groupWestport, exerciseIds: [ex[0].id] }, ...as(bruno) });
    expect(cross.statusCode).toBe(400);
    const alex = await login('alex@northbridge.demo');
    const notMine = await app.inject({ method: 'POST', url: '/api/assignments', payload: { groupId: IDS.groupB1, exerciseIds: [ex[0].id] }, ...as(alex) });
    expect(notMine.statusCode).toBe(403);
  });

  it('gives staff a per-group and per-topic view', async () => {
    const olivia = await login('olivia@northbridge.demo');
    const g = (await app.inject({ url: `/api/progress/group?groupId=${IDS.groupB1}`, ...as(olivia) })).json();
    expect(g.students).toHaveLength(4);
    expect(g.topics[0].topic).toBe('Present Perfect');
  });
});
