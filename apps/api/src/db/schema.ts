import { sql } from 'drizzle-orm';
import {
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Treoo data model (MVP). Every domain table carries academy_id; the API derives
 * it from the authenticated session and never from request bodies (TD-02).
 */
export const treoo = pgSchema('treoo');

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = treoo.enum('role', ['admin', 'teacher', 'student']);
export const lessonStatusEnum = treoo.enum('lesson_status', ['draft', 'ready']);
export const extractionStatusEnum = treoo.enum('extraction_status', ['none', 'manual', 'ai', 'mock', 'failed']);
export const sessionStatusEnum = treoo.enum('class_session_status', ['planned', 'delivered']);
export const attendanceStatusEnum = treoo.enum('attendance_status', ['present', 'absent', 'late', 'excused']);
export const exerciseTypeEnum = treoo.enum('exercise_type', ['single_choice', 'true_false', 'short_answer']);

// ---------- Organisation & access ----------

export const academy = treoo.table('academy', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
}, (t) => [check('academy_name_not_blank', sql`length(btrim(${t.name})) > 0`)]);

export const appUser = treoo.table('app_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('app_user_email_uq').on(sql`lower(${t.email})`)]);

export const membership = treoo.table('membership', {
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.academyId, t.userId] }), index('membership_user_idx').on(t.userId)]);

export const authSession = treoo.table('auth_session', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  academyId: uuid('academy_id').references(() => academy.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index('auth_session_user_idx').on(t.userId)]);

// ---------- School operation ----------

export const studentGroup = treoo.table('student_group', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  level: text('level'),
  schedule: text('schedule'),
  teacherId: uuid('teacher_id').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [index('student_group_academy_idx').on(t.academyId)]);

export const enrollment = treoo.table('enrollment', {
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  groupId: uuid('group_id').notNull().references(() => studentGroup.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.groupId, t.studentId] }), index('enrollment_student_idx').on(t.academyId, t.studentId)]);

// ---------- Teacher preparation (cut A) ----------

export const material = treoo.table('material', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  ownerId: uuid('owner_id').notNull().references(() => appUser.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  source: text('source'),
  originalFilename: text('original_filename'),
  mimeType: text('mime_type'),
  storageKey: text('storage_key'),
  sizeBytes: integer('size_bytes'),
  sourceText: text('source_text'),
  extractedText: text('extracted_text'),
  extractionStatus: extractionStatusEnum('extraction_status').notNull().default('none'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('material_academy_idx').on(t.academyId, t.createdAt)]);

export const lesson = treoo.table('lesson', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  ownerId: uuid('owner_id').notNull().references(() => appUser.id, { onDelete: 'restrict' }),
  materialId: uuid('material_id').references(() => material.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  topic: text('topic'),
  level: text('level'),
  objective: text('objective'),
  methodology: text('methodology'),
  notes: text('notes'),
  status: lessonStatusEnum('status').notNull().default('draft'),
  aiOrigin: text('ai_origin'),
  revision: integer('revision').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('lesson_title_not_blank', sql`length(btrim(${t.title})) > 0`),
  check('lesson_revision_positive', sql`${t.revision} > 0`),
  index('lesson_owner_recent_idx').on(t.academyId, t.ownerId, t.updatedAt),
]);

export const activity = treoo.table('activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  lessonId: uuid('lesson_id').notNull().references(() => lesson.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  kind: text('kind'),
  title: text('title'),
  instructions: text('instructions'),
  durationMinutes: doublePrecision('duration_minutes'),
}, (t) => [
  uniqueIndex('activity_lesson_position_uq').on(t.lessonId, t.position),
  check('activity_duration_positive', sql`${t.durationMinutes} IS NULL OR (${t.durationMinutes} > 0 AND ${t.durationMinutes} < 'Infinity'::float8)`),
]);

/** Idempotency ledger: replays the stored response for a repeated key + identical request. */
export const mutationDedup = treoo.table('mutation_dedup', {
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  operationKey: text('operation_key').notNull(),
  operationKind: text('operation_kind').notNull(),
  requestHash: text('request_hash').notNull(),
  statusCode: integer('status_code').notNull(),
  response: jsonb('response').notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.academyId, t.userId, t.operationKey] })]);

// ---------- Classroom, diary & practice ----------

export const classSession = treoo.table('class_session', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  groupId: uuid('group_id').notNull().references(() => studentGroup.id, { onDelete: 'cascade' }),
  lessonId: uuid('lesson_id').references(() => lesson.id, { onDelete: 'set null' }),
  teacherId: uuid('teacher_id').notNull().references(() => appUser.id, { onDelete: 'restrict' }),
  scheduledOn: date('scheduled_on').notNull(),
  topic: text('topic'),
  status: sessionStatusEnum('status').notNull().default('planned'),
  sharedNotes: text('shared_notes'),
  privateNotes: text('private_notes'),
  boardKey: text('board_key'),
  shareBoard: integer('share_board').notNull().default(0),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('class_session_group_date_idx').on(t.academyId, t.groupId, t.scheduledOn)]);

export const attendance = treoo.table('attendance', {
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  sessionId: uuid('session_id').notNull().references(() => classSession.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  status: attendanceStatusEnum('status').notNull(),
}, (t) => [primaryKey({ columns: [t.sessionId, t.studentId] })]);

export const exercise = treoo.table('exercise', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  ownerId: uuid('owner_id').notNull().references(() => appUser.id, { onDelete: 'restrict' }),
  lessonId: uuid('lesson_id').references(() => lesson.id, { onDelete: 'set null' }),
  topic: text('topic'),
  type: exerciseTypeEnum('type').notNull(),
  prompt: text('prompt').notNull(),
  options: jsonb('options').$type<string[]>(),
  correctAnswer: jsonb('correct_answer').$type<number | boolean | string | null>(),
  points: integer('points').notNull().default(1),
  createdAt: createdAt(),
}, (t) => [index('exercise_academy_idx').on(t.academyId)]);

export const assignment = treoo.table('assignment', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  groupId: uuid('group_id').notNull().references(() => studentGroup.id, { onDelete: 'cascade' }),
  exerciseId: uuid('exercise_id').notNull().references(() => exercise.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').references(() => classSession.id, { onDelete: 'set null' }),
  dueOn: date('due_on'),
  createdAt: createdAt(),
}, (t) => [index('assignment_group_idx').on(t.academyId, t.groupId)]);

export const attempt = treoo.table('attempt', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  assignmentId: uuid('assignment_id').notNull().references(() => assignment.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  answer: jsonb('answer').$type<number | boolean | string>().notNull(),
  autoScore: doublePrecision('auto_score'),
  teacherScore: doublePrecision('teacher_score'),
  feedback: text('feedback'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('attempt_student_idx').on(t.academyId, t.studentId, t.assignmentId)]);
