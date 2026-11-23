import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AiUnavailableError } from '../ai/adapter.js';
import { ctx, type Ctx } from '../auth/context.js';
import type { Db } from '../db/client.js';
import { appUser, material } from '../db/schema.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { sniffImage } from '../lib/storage.js';
import { optText, parse, reqText, uuidParam } from '../lib/validate.js';

const view = (m: typeof material.$inferSelect) => ({
  id: m.id, title: m.title, source: m.source, ownerId: m.ownerId, originalFilename: m.originalFilename, mimeType: m.mimeType,
  hasOriginal: !!m.storageKey, sizeBytes: m.sizeBytes, sourceText: m.sourceText, extractedText: m.extractedText,
  extractionStatus: m.extractionStatus, createdAt: m.createdAt, updatedAt: m.updatedAt,
});

export async function getMaterial(db: Db, c: Ctx, id: string, write = false) {
  const [m] = await db.select().from(material).where(and(eq(material.id, id), eq(material.academyId, c.academyId)));
  if (!m) throw notFound('Material');
  if (c.role === 'student') throw notFound('Material');
  if (write && m.ownerId !== c.userId) throw forbidden('Only the teacher who uploaded this material can change it.');
  return m;
}

export const materialRoutes: FastifyPluginAsync = async (app) => {
  const { db, storage, ai } = app.svc;

  app.get('/', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const rows = await db.select({ m: material, ownerName: appUser.displayName }).from(material)
      .innerJoin(appUser, eq(appUser.id, material.ownerId))
      .where(and(eq(material.academyId, c.academyId), c.role === 'teacher' ? eq(material.ownerId, c.userId) : undefined))
      .orderBy(desc(material.createdAt)).limit(200);
    return rows.map((r) => ({ ...view(r.m), ownerName: r.ownerName }));
  });

  /** Upload a photo (multipart) or paste text (JSON). The original is always preserved unchanged. */
  app.post('/', async (req, reply) => {
    const c = ctx(req, 'teacher', 'admin');
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw badRequest('Choose an image to upload.');
      const buf = await file.toBuffer();
      const kind = sniffImage(buf);
      if (!kind) throw new HttpError(415, 'unsupported_type', 'Upload a PNG, JPEG or WebP image.');
      const fields = file.fields as Record<string, { value?: unknown } | undefined>;
      const title = String(fields.title?.value ?? '').trim() || file.filename.replace(/\.[^.]+$/, '').slice(0, 200) || 'Worksheet photo';
      const source = String(fields.source?.value ?? '').trim().slice(0, 300) || null;
      const key = await storage.save(c.academyId, buf, kind.ext);
      const [m] = await db.insert(material).values({
        academyId: c.academyId, ownerId: c.userId, title: title.slice(0, 200), source,
        originalFilename: file.filename.slice(0, 255), mimeType: kind.mime, storageKey: key, sizeBytes: buf.length,
      }).returning();
      return reply.status(201).send(view(m!));
    }
    const body = parse(z.object({ title: reqText(200, 'Title'), source: optText(300), text: reqText(50_000, 'Text') }), req.body);
    const [m] = await db.insert(material).values({
      academyId: c.academyId, ownerId: c.userId, title: body.title, source: body.source,
      sourceText: body.text, extractedText: body.text, extractionStatus: 'manual',
    }).returning();
    return reply.status(201).send(view(m!));
  });

  app.get('/:id', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { id } = parse(uuidParam, req.params);
    return view(await getMaterial(db, c, id));
  });

  /** Teacher reviews/corrects the extraction. The original file or pasted source text never changes. */
  app.put('/:id', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { id } = parse(uuidParam, req.params);
    const m = await getMaterial(db, c, id, true);
    const body = parse(z.object({ title: reqText(200, 'Title'), source: optText(300), extractedText: optText(50_000) }), req.body);
    const changed = body.extractedText !== m.extractedText;
    const [u] = await db.update(material).set({
      title: body.title, source: body.source, extractedText: body.extractedText, updatedAt: new Date(),
      extractionStatus: changed ? 'manual' : m.extractionStatus,
    }).where(and(eq(material.id, id), eq(material.academyId, c.academyId))).returning();
    return view(u!);
  });

  app.post('/:id/extract', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { id } = parse(uuidParam, req.params);
    const m = await getMaterial(db, c, id, true);
    if (!m.storageKey || !m.mimeType) throw badRequest('This material has no image to extract from.');
    const data = await storage.read(m.storageKey);
    try {
      const r = await ai.extract({ base64: data.toString('base64'), mime: m.mimeType });
      const [u] = await db.update(material).set({ extractedText: r.text, extractionStatus: r.origin === 'mock' ? 'mock' : 'ai', updatedAt: new Date() })
        .where(and(eq(material.id, id), eq(material.academyId, c.academyId))).returning();
      return view(u!);
    } catch (e) {
      if (e instanceof AiUnavailableError) {
        await db.update(material).set({ extractionStatus: m.extractedText ? m.extractionStatus : 'failed', updatedAt: new Date() }).where(eq(material.id, id));
        throw new HttpError(503, 'ai_unavailable', `${e.message} You can type or paste the text yourself.`);
      }
      throw e;
    }
  });

  app.get('/:id/original', async (req, reply) => {
    const c = ctx(req, 'admin', 'teacher');
    const { id } = parse(uuidParam, req.params);
    const m = await getMaterial(db, c, id);
    if (!m.storageKey || !m.mimeType) throw notFound('Original file');
    reply.header('content-type', m.mimeType);
    reply.header('cache-control', 'private, max-age=300');
    reply.header('content-security-policy', "default-src 'none'; sandbox");
    return reply.send(storage.stream(m.storageKey));
  });
};
