export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

type Opts = { method?: string; body?: unknown; idempotent?: boolean; form?: FormData };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  if (opts.idempotent) headers['idempotency-key'] = crypto.randomUUID();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'offline', 'Treoo could not reach the server. Check your connection and try again — nothing has been lost on this screen.');
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? `Request failed (${res.status}).`, e.details);
  }
  return json as T;
}

/** Retries a mutation with the SAME idempotency key, so a lost response never duplicates the change. */
export async function saveWithRetry<T>(path: string, method: 'POST' | 'PUT', body: unknown): Promise<T> {
  const key = crypto.randomUUID();
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`/api${path}`, { method, headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body), credentials: 'same-origin' });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? 'Save failed.', json?.error?.details);
      return json as T;
    } catch (e) {
      lastErr = e;
      if (e instanceof ApiError && e.status !== 0 && e.status < 500) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr instanceof ApiError ? lastErr : new ApiError(0, 'offline', 'Could not save — the server is not responding. Your edits are still here; try again.');
}

export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', opts);
export const fmtMinutes = (m: number) => (Number.isInteger(m) ? `${m}` : m.toFixed(1)) + ' min';
export const today = () => new Date().toISOString().slice(0, 10);

// ---- Shared types ----
export type Role = 'admin' | 'teacher' | 'student';
export interface Me {
  user: { id: string; email: string; displayName: string };
  active: { academyId: string; role: Role } | null;
  memberships: { academyId: string; academyName: string; role: Role }[];
}
export interface Activity { id?: string; kind: string | null; title: string | null; instructions: string | null; durationMinutes: number | null }
export interface Exercise { id: string; type: 'single_choice' | 'true_false' | 'short_answer' | 'gap_fill'; prompt: string; options: string[] | null; correctAnswer: number | boolean | string | string[][] | null; topic: string | null; points: number }
export interface Lesson {
  id: string; title: string; topic: string | null; level: string | null; objective: string | null; methodology: string | null; notes: string | null;
  status: 'draft' | 'ready'; materialId: string | null; curriculumTopicId?: string | null; aiOrigin: string | null; revision: number; updatedAt: string; ownerId: string; ownerName: string;
  activities: Activity[]; totalMinutes: number; activitiesWithoutDuration: number; exercises?: Exercise[]; canEdit?: boolean;
}
export interface Material {
  id: string; title: string; source: string | null; hasOriginal: boolean; mimeType: string | null; sourceText: string | null;
  extractedText: string | null; extractionStatus: 'none' | 'manual' | 'ai' | 'mock' | 'failed'; createdAt: string; ownerName?: string;
}
export interface Group { id: string; name: string; level: string | null; schedule: string | null; teacherId: string | null; siteId?: string | null; teacherName: string | null; studentCount: number }
export interface Person { id: string; displayName: string; email: string; role: Role }
