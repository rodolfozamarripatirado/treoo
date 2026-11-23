CREATE SCHEMA IF NOT EXISTS "treoo";
--> statement-breakpoint
CREATE TYPE "treoo"."attendance_status" AS ENUM('present', 'absent', 'late', 'excused');--> statement-breakpoint
CREATE TYPE "treoo"."exercise_type" AS ENUM('single_choice', 'true_false', 'short_answer');--> statement-breakpoint
CREATE TYPE "treoo"."extraction_status" AS ENUM('none', 'manual', 'ai', 'mock', 'failed');--> statement-breakpoint
CREATE TYPE "treoo"."lesson_status" AS ENUM('draft', 'ready');--> statement-breakpoint
CREATE TYPE "treoo"."role" AS ENUM('admin', 'teacher', 'student');--> statement-breakpoint
CREATE TYPE "treoo"."class_session_status" AS ENUM('planned', 'delivered');--> statement-breakpoint
CREATE TABLE "treoo"."academy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academy_name_not_blank" CHECK (length(btrim("treoo"."academy"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "treoo"."activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text,
	"title" text,
	"instructions" text,
	"duration_minutes" double precision,
	CONSTRAINT "activity_duration_positive" CHECK ("treoo"."activity"."duration_minutes" IS NULL OR ("treoo"."activity"."duration_minutes" > 0 AND "treoo"."activity"."duration_minutes" < 'Infinity'::float8))
);
--> statement-breakpoint
CREATE TABLE "treoo"."app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treoo"."assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"session_id" uuid,
	"due_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treoo"."attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"answer" jsonb NOT NULL,
	"auto_score" double precision,
	"teacher_score" double precision,
	"feedback" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treoo"."attendance" (
	"academy_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "treoo"."attendance_status" NOT NULL,
	CONSTRAINT "attendance_session_id_student_id_pk" PRIMARY KEY("session_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "treoo"."auth_session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"academy_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treoo"."class_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"lesson_id" uuid,
	"teacher_id" uuid NOT NULL,
	"scheduled_on" date NOT NULL,
	"topic" text,
	"status" "treoo"."class_session_status" DEFAULT 'planned' NOT NULL,
	"shared_notes" text,
	"private_notes" text,
	"board_key" text,
	"share_board" integer DEFAULT 0 NOT NULL,
	"delivered_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treoo"."enrollment" (
	"academy_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_group_id_student_id_pk" PRIMARY KEY("group_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "treoo"."exercise" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"lesson_id" uuid,
	"topic" text,
	"type" "treoo"."exercise_type" NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb,
	"correct_answer" jsonb,
	"points" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treoo"."lesson" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"material_id" uuid,
	"title" text NOT NULL,
	"topic" text,
	"level" text,
	"objective" text,
	"methodology" text,
	"notes" text,
	"status" "treoo"."lesson_status" DEFAULT 'draft' NOT NULL,
	"ai_origin" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_title_not_blank" CHECK (length(btrim("treoo"."lesson"."title")) > 0),
	CONSTRAINT "lesson_revision_positive" CHECK ("treoo"."lesson"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "treoo"."material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source" text,
	"original_filename" text,
	"mime_type" text,
	"storage_key" text,
	"size_bytes" integer,
	"source_text" text,
	"extracted_text" text,
	"extraction_status" "treoo"."extraction_status" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treoo"."membership" (
	"academy_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "treoo"."role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_academy_id_user_id_pk" PRIMARY KEY("academy_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "treoo"."mutation_dedup" (
	"academy_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"operation_key" text NOT NULL,
	"operation_kind" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_dedup_academy_id_user_id_operation_key_pk" PRIMARY KEY("academy_id","user_id","operation_key")
);
--> statement-breakpoint
CREATE TABLE "treoo"."student_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" text,
	"schedule" text,
	"teacher_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "treoo"."activity" ADD CONSTRAINT "activity_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."activity" ADD CONSTRAINT "activity_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "treoo"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."assignment" ADD CONSTRAINT "assignment_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."assignment" ADD CONSTRAINT "assignment_group_id_student_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "treoo"."student_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."assignment" ADD CONSTRAINT "assignment_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "treoo"."exercise"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."assignment" ADD CONSTRAINT "assignment_session_id_class_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "treoo"."class_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."attempt" ADD CONSTRAINT "attempt_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."attempt" ADD CONSTRAINT "attempt_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "treoo"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."attempt" ADD CONSTRAINT "attempt_student_id_app_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "treoo"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."attendance" ADD CONSTRAINT "attendance_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."attendance" ADD CONSTRAINT "attendance_session_id_class_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "treoo"."class_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."attendance" ADD CONSTRAINT "attendance_student_id_app_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "treoo"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."auth_session" ADD CONSTRAINT "auth_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "treoo"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."auth_session" ADD CONSTRAINT "auth_session_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."class_session" ADD CONSTRAINT "class_session_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."class_session" ADD CONSTRAINT "class_session_group_id_student_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "treoo"."student_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."class_session" ADD CONSTRAINT "class_session_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "treoo"."lesson"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."class_session" ADD CONSTRAINT "class_session_teacher_id_app_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "treoo"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."enrollment" ADD CONSTRAINT "enrollment_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."enrollment" ADD CONSTRAINT "enrollment_group_id_student_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "treoo"."student_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."enrollment" ADD CONSTRAINT "enrollment_student_id_app_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "treoo"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."exercise" ADD CONSTRAINT "exercise_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."exercise" ADD CONSTRAINT "exercise_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "treoo"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."exercise" ADD CONSTRAINT "exercise_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "treoo"."lesson"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."lesson" ADD CONSTRAINT "lesson_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."lesson" ADD CONSTRAINT "lesson_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "treoo"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."lesson" ADD CONSTRAINT "lesson_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "treoo"."material"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."material" ADD CONSTRAINT "material_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."material" ADD CONSTRAINT "material_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "treoo"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."membership" ADD CONSTRAINT "membership_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."membership" ADD CONSTRAINT "membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "treoo"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."mutation_dedup" ADD CONSTRAINT "mutation_dedup_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."mutation_dedup" ADD CONSTRAINT "mutation_dedup_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "treoo"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."student_group" ADD CONSTRAINT "student_group_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."student_group" ADD CONSTRAINT "student_group_teacher_id_app_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "treoo"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_lesson_position_uq" ON "treoo"."activity" USING btree ("lesson_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_uq" ON "treoo"."app_user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "assignment_group_idx" ON "treoo"."assignment" USING btree ("academy_id","group_id");--> statement-breakpoint
CREATE INDEX "attempt_student_idx" ON "treoo"."attempt" USING btree ("academy_id","student_id","assignment_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "treoo"."auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "class_session_group_date_idx" ON "treoo"."class_session" USING btree ("academy_id","group_id","scheduled_on");--> statement-breakpoint
CREATE INDEX "enrollment_student_idx" ON "treoo"."enrollment" USING btree ("academy_id","student_id");--> statement-breakpoint
CREATE INDEX "exercise_academy_idx" ON "treoo"."exercise" USING btree ("academy_id");--> statement-breakpoint
CREATE INDEX "lesson_owner_recent_idx" ON "treoo"."lesson" USING btree ("academy_id","owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "material_academy_idx" ON "treoo"."material" USING btree ("academy_id","created_at");--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "treoo"."membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "student_group_academy_idx" ON "treoo"."student_group" USING btree ("academy_id");