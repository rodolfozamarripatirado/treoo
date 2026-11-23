import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createAiAdapter, type AiAdapter } from './ai/adapter.js';
import { COOKIE_NAME, loadAuth } from './auth/context.js';
import type { Db } from './db/client.js';
import type { Env } from './env.js';
import { HttpError } from './lib/errors.js';
import { Storage } from './lib/storage.js';
import { authRoutes } from './routes/auth.js';
import { peopleRoutes } from './routes/people.js';
import { groupRoutes } from './routes/groups.js';
import { materialRoutes } from './routes/materials.js';
import { lessonRoutes } from './routes/lessons.js';
import { aiRoutes } from './routes/ai.js';
import { sessionRoutes } from './routes/sessions.js';
import { exerciseRoutes } from './routes/exercises.js';
import { portalRoutes } from './routes/portal.js';
import { progressRoutes } from './routes/progress.js';
import { vocabRoutes } from './routes/vocab.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { studentRoutes } from './routes/students.js';
import { academyRoutes } from './routes/academy.js';
import { curriculumRoutes } from './routes/curriculum.js';
import { assessmentRoutes } from './routes/assessments.js';
import { calendarRoutes } from './routes/calendar.js';

export interface Deps {
  env: Env;
  db: Db;
  ai?: AiAdapter;
  storage?: Storage;
}

export interface AppServices { env: Env; db: Db; ai: AiAdapter; storage: Storage }

declare module 'fastify' {
  interface FastifyInstance { svc: AppServices }
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const { env, db } = deps;
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });
  const svc: AppServices = { env, db, ai: deps.ai ?? createAiAdapter(env), storage: deps.storage ?? new Storage(path.resolve(env.UPLOAD_DIR)) };
  app.decorate('svc', svc);
  app.decorateRequest('auth', null);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10 } });
  await app.register(rateLimit, { global: false, hook: 'preHandler' });

  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/')) req.auth = await loadAuth(db, req.cookies[COOKIE_NAME]);
  });

  // Basic CSRF defence for cookie auth: state-changing API calls must come from our own origin.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'bad_origin', 'Request origin not allowed.');
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') return reply.status(413).send({ error: { code: 'too_large', message: `Files must be smaller than ${env.MAX_UPLOAD_MB} MB.` } });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: { code: e.code ?? 'bad_request', message: e.message } });
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong on our side. Your last saved version is safe — please try again.' } });
  });

  app.get('/api/health', async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(peopleRoutes, { prefix: '/api/people' });
  await app.register(groupRoutes, { prefix: '/api/groups' });
  await app.register(materialRoutes, { prefix: '/api/materials' });
  await app.register(lessonRoutes, { prefix: '/api/lessons' });
  await app.register(aiRoutes, { prefix: '/api/ai' });
  await app.register(sessionRoutes, { prefix: '/api/sessions' });
  await app.register(exerciseRoutes, { prefix: '/api' });
  await app.register(portalRoutes, { prefix: '/api/portal' });
  await app.register(progressRoutes, { prefix: '/api/progress' });
  await app.register(vocabRoutes, { prefix: '/api' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(studentRoutes, { prefix: '/api/students' });
  await app.register(academyRoutes, { prefix: '/api/academy' });
  await app.register(curriculumRoutes, { prefix: '/api/curriculum' });
  await app.register(assessmentRoutes, { prefix: '/api/assessments' });
  await app.register(calendarRoutes, { prefix: '/api' });

  // Serve the built web app (single container) with SPA fallback.
  const webDist = env.WEB_DIST ? path.resolve(env.WEB_DIST) : null;
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
