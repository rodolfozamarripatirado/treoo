import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AiUnavailableError } from '../ai/adapter.js';
import { ctx } from '../auth/context.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { optText, parse } from '../lib/validate.js';
import { getMaterial } from './materials.js';

export const aiRoutes: FastifyPluginAsync = async (app) => {
  const { db, ai } = app.svc;

  app.get('/status', async (req) => {
    ctx(req, 'admin', 'teacher');
    return ai.status();
  });

  /** Returns an unsaved proposal. Nothing is stored until the teacher reviews it and saves. */
  app.post('/draft', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const c = ctx(req, 'teacher', 'admin');
    const body = parse(z.object({
      materialId: z.string().uuid().optional(),
      sourceText: optText(50_000),
      level: optText(40),
      topic: optText(200),
      totalMinutes: z.number().positive().max(600).nullable().optional(),
      preferences: optText(1000),
    }), req.body);
    let text = body.sourceText;
    let topic = body.topic;
    if (!text && body.materialId) {
      const m = await getMaterial(db, c, body.materialId);
      text = m.extractedText;
      topic ??= m.title.replace(/^(unit|lesson)\s*\d+\s*[—–:-]\s*/i, '').trim() || null;
    }
    if (!text) throw badRequest('Add or review the source text first.');
    try {
      return await ai.draftLesson({ sourceText: text, level: body.level, topic, totalMinutes: body.totalMinutes ?? null, preferences: body.preferences });
    } catch (e) {
      if (e instanceof AiUnavailableError) throw new HttpError(503, 'ai_unavailable', `${e.message} You can still build the lesson manually.`);
      throw e;
    }
  });
};
