ALTER TYPE "treoo"."class_session_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "treoo"."curriculum_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"level" text NOT NULL,
	"version" integer NOT NULL,
	"notes" text,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treoo"."curriculum_plan_topic" (
	"plan_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"unit_title" text NOT NULL,
	"topic_title" text NOT NULL,
	"objective" text,
	"position" integer NOT NULL,
	CONSTRAINT "curriculum_plan_topic_plan_id_topic_id_pk" PRIMARY KEY("plan_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "treoo"."room" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer
);
--> statement-breakpoint
ALTER TABLE "treoo"."academy" ADD COLUMN "timezone" text DEFAULT 'Europe/Dublin' NOT NULL;--> statement-breakpoint
ALTER TABLE "treoo"."assignment" ADD COLUMN "due_time" time;--> statement-breakpoint
ALTER TABLE "treoo"."class_session" ADD COLUMN "start_time" time;--> statement-breakpoint
ALTER TABLE "treoo"."class_session" ADD COLUMN "end_time" time;--> statement-breakpoint
ALTER TABLE "treoo"."class_session" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "treoo"."class_session" ADD COLUMN "cancelled_reason" text;--> statement-breakpoint
ALTER TABLE "treoo"."class_session" ADD COLUMN "published_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "treoo"."curriculum_topic" ADD COLUMN "required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "treoo"."curriculum_topic" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "treoo"."curriculum_unit" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "treoo"."student_group" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "treoo"."curriculum_plan" ADD CONSTRAINT "curriculum_plan_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."curriculum_plan" ADD CONSTRAINT "curriculum_plan_published_by_app_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "treoo"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."curriculum_plan_topic" ADD CONSTRAINT "curriculum_plan_topic_plan_id_curriculum_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "treoo"."curriculum_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."curriculum_plan_topic" ADD CONSTRAINT "curriculum_plan_topic_topic_id_curriculum_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "treoo"."curriculum_topic"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."room" ADD CONSTRAINT "room_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."room" ADD CONSTRAINT "room_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "treoo"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_plan_version_uq" ON "treoo"."curriculum_plan" USING btree ("academy_id","level","version");--> statement-breakpoint
CREATE INDEX "room_site_idx" ON "treoo"."room" USING btree ("academy_id","site_id");--> statement-breakpoint
ALTER TABLE "treoo"."class_session" ADD CONSTRAINT "class_session_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "treoo"."room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."student_group" ADD CONSTRAINT "student_group_plan_id_curriculum_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "treoo"."curriculum_plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."class_session" ADD CONSTRAINT "class_session_time_order" CHECK ("treoo"."class_session"."start_time" IS NULL OR "treoo"."class_session"."end_time" IS NULL OR "treoo"."class_session"."end_time" > "treoo"."class_session"."start_time");--> statement-breakpoint
-- Backfill: freeze the content of classes that were already published, so later lesson edits stop changing them.
UPDATE "treoo"."class_session" s SET "published_snapshot" = jsonb_build_object(
  'lessonRevision', l.revision, 'title', l.title, 'topic', l.topic, 'level', l.level, 'objective', l.objective,
  'activities', coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'title', a.title, 'instructions', a.instructions, 'durationMinutes', a.duration_minutes) order by a.position) from "treoo"."activity" a where a.lesson_id = l.id), '[]'::jsonb),
  'vocab', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'term', v.term, 'partOfSpeech', v.part_of_speech, 'meaning', v.meaning, 'example', v.example) order by v.position) from "treoo"."vocab_item" v where v.lesson_id = l.id), '[]'::jsonb),
  'frozenAt', to_jsonb(now()))
FROM "treoo"."lesson" l WHERE l.id = s.lesson_id AND s.published_at IS NOT NULL AND s.published_snapshot IS NULL;
