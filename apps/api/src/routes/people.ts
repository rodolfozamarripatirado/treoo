import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ctx } from '../auth/context.js';
import { hashPassword } from '../auth/password.js';
import { appUser, membership } from '../db/schema.js';
import { conflict } from '../lib/errors.js';
import { parse, reqText } from '../lib/validate.js';

export const peopleRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.svc;

  app.get('/', async (req) => {
    const c = ctx(req, 'admin', 'teacher');
    const { role } = parse(z.object({ role: z.enum(['admin', 'teacher', 'student']).optional() }), req.query);
    return db.select({ id: appUser.id, displayName: appUser.displayName, email: appUser.email, role: membership.role })
      .from(membership).innerJoin(appUser, eq(appUser.id, membership.userId))
      .where(and(eq(membership.academyId, c.academyId), role ? eq(membership.role, role) : undefined))
      .orderBy(asc(appUser.displayName));
  });

  /** Admin adds a person to the academy (creates the account if the email is new). */
  app.post('/', async (req, reply) => {
    const c = ctx(req, 'admin');
    const body = parse(z.object({
      displayName: reqText(120, 'Name'),
      email: z.string().trim().email('Enter a valid email.').max(200),
      role: z.enum(['admin', 'teacher', 'student']),
      password: z.string().min(10, 'Use at least 10 characters.').max(200).optional(),
    }), req.body);
    const result = await db.transaction(async (tx) => {
      let [user] = await tx.select().from(appUser).where(sql`lower(${appUser.email}) = lower(${body.email})`);
      if (!user) {
        if (!body.password) throw conflict('Set an initial password for this new account.');
        [user] = await tx.insert(appUser).values({ email: body.email, displayName: body.displayName, passwordHash: await hashPassword(body.password) }).returning();
      }
      const inserted = await tx.insert(membership).values({ academyId: c.academyId, userId: user!.id, role: body.role }).onConflictDoNothing().returning();
      if (!inserted.length) throw conflict('This person is already a member of the academy.');
      return { id: user!.id, displayName: user!.displayName, email: user!.email, role: body.role };
    });
    return reply.status(201).send(result);
  });
};
