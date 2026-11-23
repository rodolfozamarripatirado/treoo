CREATE TYPE "treoo"."assessment_kind" AS ENUM('baseline', 'checkpoint', 'final', 'quiz');--> statement-breakpoint
CREATE TYPE "treoo"."calendar_event_kind" AS ENUM('holiday', 'event', 'exam');--> statement-breakpoint
ALTER TYPE "treoo"."exercise_type" ADD VALUE 'gap_fill';--> statement-breakpoint
CREATE TABLE "treoo"."assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"group_id" uuid,
	"assessor_id" uuid NOT NULL,
	"kind" "treoo"."assessment_kind" NOT NULL,
	"taken_on" date NOT NULL,
	"instrument" text,
	"scores" jsonb NOT NULL,
	"cefr" text,
	"strengths" text,
	"next_steps" text,
	"shared_with_student" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treoo"."calendar_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"site_id" uuid,
	"kind" "treoo"."calendar_event_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"capacity" integer,
	"signup_open" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_range" CHECK ("treoo"."calendar_event"."ends_on" >= "treoo"."calendar_event"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "treoo"."curriculum_topic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"objective" text,
	"skill" text
);
--> statement-breakpoint
CREATE TABLE "treoo"."curriculum_unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"level" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treoo"."event_signup" (
	"academy_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_signup_event_id_student_id_pk" PRIMARY KEY("event_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "treoo"."site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treoo"."student_goal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"text" text NOT NULL,
	"target_date" date,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "treoo"."class_session" ADD COLUMN "share_material" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "treoo"."lesson" ADD COLUMN "curriculum_topic_id" uuid;--> statement-breakpoint
ALTER TABLE "treoo"."student_group" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "treoo"."assessment" ADD CONSTRAINT "assessment_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."assessment" ADD CONSTRAINT "assessment_student_id_app_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "treoo"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."assessment" ADD CONSTRAINT "assessment_group_id_student_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "treoo"."student_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."assessment" ADD CONSTRAINT "assessment_assessor_id_app_user_id_fk" FOREIGN KEY ("assessor_id") REFERENCES "treoo"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."calendar_event" ADD CONSTRAINT "calendar_event_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."calendar_event" ADD CONSTRAINT "calendar_event_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "treoo"."site"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."curriculum_topic" ADD CONSTRAINT "curriculum_topic_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."curriculum_topic" ADD CONSTRAINT "curriculum_topic_unit_id_curriculum_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "treoo"."curriculum_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."curriculum_unit" ADD CONSTRAINT "curriculum_unit_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."event_signup" ADD CONSTRAINT "event_signup_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."event_signup" ADD CONSTRAINT "event_signup_event_id_calendar_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "treoo"."calendar_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."event_signup" ADD CONSTRAINT "event_signup_student_id_app_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "treoo"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."site" ADD CONSTRAINT "site_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."student_goal" ADD CONSTRAINT "student_goal_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."student_goal" ADD CONSTRAINT "student_goal_student_id_app_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "treoo"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_student_idx" ON "treoo"."assessment" USING btree ("academy_id","student_id","taken_on");--> statement-breakpoint
CREATE INDEX "calendar_event_dates_idx" ON "treoo"."calendar_event" USING btree ("academy_id","starts_on");--> statement-breakpoint
CREATE INDEX "curriculum_topic_unit_idx" ON "treoo"."curriculum_topic" USING btree ("unit_id","position");--> statement-breakpoint
CREATE INDEX "curriculum_unit_level_idx" ON "treoo"."curriculum_unit" USING btree ("academy_id","level","position");--> statement-breakpoint
CREATE INDEX "site_academy_idx" ON "treoo"."site" USING btree ("academy_id");--> statement-breakpoint
CREATE INDEX "student_goal_student_idx" ON "treoo"."student_goal" USING btree ("academy_id","student_id");--> statement-breakpoint
ALTER TABLE "treoo"."lesson" ADD CONSTRAINT "lesson_curriculum_topic_id_curriculum_topic_id_fk" FOREIGN KEY ("curriculum_topic_id") REFERENCES "treoo"."curriculum_topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."student_group" ADD CONSTRAINT "student_group_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "treoo"."site"("id") ON DELETE set null ON UPDATE no action;