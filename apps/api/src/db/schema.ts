import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  time,
  boolean,
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
export const sessionStatusEnum = treoo.enum('class_session_status', ['planned', 'delivered', 'cancelled']);
export const attendanceStatusEnum = treoo.enum('attendance_status', ['present', 'absent', 'late', 'excused']);
export const exerciseTypeEnum = treoo.enum('exercise_type', ['single_choice', 'true_false', 'short_answer', 'gap_fill']);

// ---------- Organisation & access ----------

export const academy = treoo.table('academy', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** IANA time zone. Class dates and times are local wall-clock times in this zone. */
  timezone: text('timezone').notNull().default('Europe/Dublin'),
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
  siteId: uuid('site_id').references((): AnyPgColumn => site.id, { onDelete: 'set null' }),
  planId: uuid('plan_id').references((): AnyPgColumn => curriculumPlan.id, { onDelete: 'restrict' }),
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
  curriculumTopicId: uuid('curriculum_topic_id').references((): AnyPgColumn => curriculumTopic.id, { onDelete: 'set null' }),
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
  startTime: time('start_time'),
  endTime: time('end_time'),
  roomId: uuid('room_id').references((): AnyPgColumn => room.id, { onDelete: 'set null' }),
  topic: text('topic'),
  status: sessionStatusEnum('status').notNull().default('planned'),
  cancelledReason: text('cancelled_reason'),
  /** Lesson content frozen at publication, so later edits never change what students already saw. */
  publishedSnapshot: jsonb('published_snapshot').$type<PublishedSnapshot>(),
  sharedNotes: text('shared_notes'),
  privateNotes: text('private_notes'),
  boardKey: text('board_key'),
  shareBoard: integer('share_board').notNull().default(0),
  shareMaterial: integer('share_material').notNull().default(0),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index('class_session_group_date_idx').on(t.academyId, t.groupId, t.scheduledOn),
  check('class_session_time_order', sql`${t.startTime} IS NULL OR ${t.endTime} IS NULL OR ${t.endTime} > ${t.startTime}`),
]);

export interface PublishedSnapshot {
  lessonRevision: number;
  title: string; topic: string | null; level: string | null; objective: string | null;
  activities: { kind: string | null; title: string | null; instructions: string | null; durationMinutes: number | null }[];
  vocab: { id: string; term: string; partOfSpeech: string | null; meaning: string | null; example: string | null }[];
  frozenAt: string;
}

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
  correctAnswer: jsonb('correct_answer').$type<number | boolean | string | string[][] | null>(),
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
  /** Optional local time on dueOn (academy time zone); end of day when empty. */
  dueTime: time('due_time'),
  createdAt: createdAt(),
}, (t) => [index('assignment_group_idx').on(t.academyId, t.groupId)]);

export const attempt = treoo.table('attempt', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  assignmentId: uuid('assignment_id').notNull().references(() => assignment.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  answer: jsonb('answer').$type<number | boolean | string | string[]>().notNull(),
  autoScore: doublePrecision('auto_score'),
  teacherScore: doublePrecision('teacher_score'),
  feedback: text('feedback'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('attempt_student_idx').on(t.academyId, t.studentId, t.assignmentId)]);

// ---------- v2: vocabulary, spaced review and teacher observations ----------

export const vocabItem = treoo.table('vocab_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  lessonId: uuid('lesson_id').notNull().references(() => lesson.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  term: text('term').notNull(),
  partOfSpeech: text('part_of_speech'),
  meaning: text('meaning'),
  example: text('example'),
  createdAt: createdAt(),
}, (t) => [
  index('vocab_item_lesson_idx').on(t.academyId, t.lessonId, t.position),
  check('vocab_term_not_blank', sql`length(btrim(${t.term})) > 0`),
]);

/** Leitner box per student and word: box 1 = review today, box 5 = well known. */
export const vocabReview = treoo.table('vocab_review', {
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  studentId: uuid('student_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  vocabItemId: uuid('vocab_item_id').notNull().references(() => vocabItem.id, { onDelete: 'cascade' }),
  box: integer('box').notNull().default(1),
  nextDue: date('next_due').notNull(),
  reviews: integer('reviews').notNull().default(0),
  lapses: integer('lapses').notNull().default(0),
  updatedAt: updatedAt(),
}, (t) => [
  primaryKey({ columns: [t.studentId, t.vocabItemId] }),
  check('vocab_review_box_range', sql`${t.box} between 1 and 5`),
]);

/** Private teacher observations about a student. Never visible to students. */
export const studentNote = treoo.table('student_note', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  studentId: uuid('student_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => appUser.id, { onDelete: 'restrict' }),
  body: text('body').notNull(),
  createdAt: createdAt(),
}, (t) => [index('student_note_student_idx').on(t.academyId, t.studentId, t.createdAt)]);

// ---------- v3: sites, curriculum, assessments, calendar, goals ----------

export const site = treoo.table('site', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  address: text('address'),
  createdAt: createdAt(),
}, (t) => [index('site_academy_idx').on(t.academyId)]);

/** Academy-owned curriculum: level → units → topics with objectives (DEC-01). */
export const curriculumUnit = treoo.table('curriculum_unit', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  level: text('level').notNull(),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('curriculum_unit_level_idx').on(t.academyId, t.level, t.position)]);

export const curriculumTopic = treoo.table('curriculum_topic', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  unitId: uuid('unit_id').notNull().references(() => curriculumUnit.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  objective: text('objective'),
  skill: text('skill'),
  required: boolean('required').notNull().default(true),
  /** Topics are archived, never deleted, so lessons, coverage and published plans keep their history. */
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => [index('curriculum_topic_unit_idx').on(t.unitId, t.position)]);

/** A published, immutable version of a level's curriculum: the set of required topics at that moment. */
export const curriculumPlan = treoo.table('curriculum_plan', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  level: text('level').notNull(),
  version: integer('version').notNull(),
  notes: text('notes'),
  publishedBy: uuid('published_by').notNull().references(() => appUser.id, { onDelete: 'restrict' }),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('curriculum_plan_version_uq').on(t.academyId, t.level, t.version)]);

export const curriculumPlanTopic = treoo.table('curriculum_plan_topic', {
  planId: uuid('plan_id').notNull().references(() => curriculumPlan.id, { onDelete: 'cascade' }),
  topicId: uuid('topic_id').notNull().references(() => curriculumTopic.id, { onDelete: 'restrict' }),
  unitTitle: text('unit_title').notNull(),
  topicTitle: text('topic_title').notNull(),
  objective: text('objective'),
  position: integer('position').notNull(),
}, (t) => [primaryKey({ columns: [t.planId, t.topicId] })]);

export const assessmentKindEnum = treoo.enum('assessment_kind', ['baseline', 'checkpoint', 'final', 'quiz']);
export type SkillScores = Partial<Record<'reading' | 'listening' | 'speaking' | 'writing' | 'grammar', { score: number; max: number }>>;

/** Multi-skill assessment evidence. A CEFR estimate is optional and never an official certificate. */
export const assessment = treoo.table('assessment', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  studentId: uuid('student_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => studentGroup.id, { onDelete: 'set null' }),
  assessorId: uuid('assessor_id').notNull().references(() => appUser.id, { onDelete: 'restrict' }),
  kind: assessmentKindEnum('kind').notNull(),
  takenOn: date('taken_on').notNull(),
  instrument: text('instrument'),
  scores: jsonb('scores').$type<SkillScores>().notNull(),
  cefr: text('cefr'),
  strengths: text('strengths'),
  nextSteps: text('next_steps'),
  sharedWithStudent: boolean('shared_with_student').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index('assessment_student_idx').on(t.academyId, t.studentId, t.takenOn)]);

export const eventKindEnum = treoo.enum('calendar_event_kind', ['holiday', 'event', 'exam']);

export const calendarEvent = treoo.table('calendar_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  siteId: uuid('site_id').references(() => site.id, { onDelete: 'set null' }),
  kind: eventKindEnum('kind').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  capacity: integer('capacity'),
  signupOpen: boolean('signup_open').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index('calendar_event_dates_idx').on(t.academyId, t.startsOn), check('calendar_event_range', sql`${t.endsOn} >= ${t.startsOn}`)]);

export const eventSignup = treoo.table('event_signup', {
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  eventId: uuid('event_id').notNull().references(() => calendarEvent.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.eventId, t.studentId] })]);

export const studentGoal = treoo.table('student_goal', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  studentId: uuid('student_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  targetDate: date('target_date'),
  doneAt: timestamp('done_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('student_goal_student_idx').on(t.academyId, t.studentId)]);

export const room = treoo.table('room', {
  id: uuid('id').primaryKey().defaultRandom(),
  academyId: uuid('academy_id').notNull().references(() => academy.id, { onDelete: 'restrict' }),
  siteId: uuid('site_id').notNull().references(() => site.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  capacity: integer('capacity'),
}, (t) => [index('room_site_idx').on(t.academyId, t.siteId)]);
