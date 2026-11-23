import { z } from 'zod';
import { badRequest } from './errors.js';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message }));
    throw badRequest('Some fields are not valid. Please check them and try again.', fields);
  }
  return result.data;
}

/** Optional text: undefined/null/blank -> null, otherwise trimmed (DEC-A-002 normalisation). */
export const optText = (max = 5000) =>
  z.union([z.string().max(max), z.null()]).optional().transform((v) => {
    if (v === undefined || v === null) return null;
    const t = v.trim();
    return t === '' ? null : t;
  });

export const reqText = (max = 300, label = 'This field') =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max);

export const uuidParam = z.object({ id: z.string().uuid('Invalid identifier.') });

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.');
