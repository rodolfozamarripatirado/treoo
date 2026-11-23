import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { academy, activity, classSession, lesson, room, studentGroup, vocabItem, type PublishedSnapshot } from '../db/schema.js';

/** Local wall-clock time "HH:MM" (24 h). Combined with the date and the academy time zone. */
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the 24-hour format HH:MM.');

/** Today's date in the academy's time zone (not UTC), e.g. for "Today" and deadlines. */
export function localToday(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export const isValidTimeZone = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

export async function academyTimeZone(db: Db, academyId: string): Promise<string> {
  const [a] = await db.select({ tz: academy.timezone }).from(academy).where(eq(academy.id, academyId));
  return a?.tz ?? 'Europe/Dublin';
}

export interface Clash { sessionId: string; groupName: string; startTime: string; endTime: string; reason: 'teacher' | 'room' | 'group' }

/**
 * Overlaps on the same local date between non-cancelled classes that have times.
 * Intervals are half-open, so 10:00–11:00 and 11:00–12:00 do not clash.
 */
export async function findClashes(db: Db, academyId: string, s: { id?: string; scheduledOn: string; startTime: string | null; endTime: string | null; teacherId: string; roomId: string | null; groupId: string }): Promise<Clash[]> {
  if (!s.startTime || !s.endTime) return [];
  const rows = await db.select({
    sessionId: classSession.id, groupName: studentGroup.name, startTime: classSession.startTime, endTime: classSession.endTime,
    teacherId: classSession.teacherId, roomId: classSession.roomId, groupId: classSession.groupId,
  }).from(classSession).innerJoin(studentGroup, eq(studentGroup.id, classSession.groupId))
    .where(and(
      eq(classSession.academyId, academyId), eq(classSession.scheduledOn, s.scheduledOn), ne(classSession.status, 'cancelled'),
      s.id ? ne(classSession.id, s.id) : undefined,
      sql`${classSession.startTime} < ${s.endTime}::time and ${classSession.endTime} > ${s.startTime}::time`,
    ));
  const out: Clash[] = [];
  for (const r of rows) {
    const reason = r.teacherId === s.teacherId ? 'teacher' : s.roomId && r.roomId === s.roomId ? 'room' : r.groupId === s.groupId ? 'group' : null;
    if (reason) out.push({ sessionId: r.sessionId, groupName: r.groupName, startTime: r.startTime!.slice(0, 5), endTime: r.endTime!.slice(0, 5), reason });
  }
  return out;
}

export async function checkRoom(db: Db, academyId: string, roomId: string | null | undefined) {
  if (!roomId) return true;
  const [r] = await db.select({ id: room.id }).from(room).where(and(eq(room.id, roomId), eq(room.academyId, academyId)));
  return !!r;
}

/** Freezes what students will see for a published class. */
export async function buildSnapshot(db: Db, academyId: string, lessonId: string): Promise<PublishedSnapshot | null> {
  const [l] = await db.select().from(lesson).where(and(eq(lesson.id, lessonId), eq(lesson.academyId, academyId)));
  if (!l) return null;
  const acts = await db.select({ kind: activity.kind, title: activity.title, instructions: activity.instructions, durationMinutes: activity.durationMinutes })
    .from(activity).where(and(eq(activity.lessonId, lessonId), eq(activity.academyId, academyId))).orderBy(asc(activity.position));
  const vocab = await db.select({ id: vocabItem.id, term: vocabItem.term, partOfSpeech: vocabItem.partOfSpeech, meaning: vocabItem.meaning, example: vocabItem.example })
    .from(vocabItem).where(and(eq(vocabItem.lessonId, lessonId), eq(vocabItem.academyId, academyId))).orderBy(asc(vocabItem.position));
  return { lessonRevision: l.revision, title: l.title, topic: l.topic, level: l.level, objective: l.objective, activities: acts, vocab, frozenAt: new Date().toISOString() };
}
