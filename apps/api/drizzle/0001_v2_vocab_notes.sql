CREATE TABLE "treoo"."student_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treoo"."vocab_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academy_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"term" text NOT NULL,
	"part_of_speech" text,
	"meaning" text,
	"example" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vocab_term_not_blank" CHECK (length(btrim("treoo"."vocab_item"."term")) > 0)
);
--> statement-breakpoint
CREATE TABLE "treoo"."vocab_review" (
	"academy_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"vocab_item_id" uuid NOT NULL,
	"box" integer DEFAULT 1 NOT NULL,
	"next_due" date NOT NULL,
	"reviews" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vocab_review_student_id_vocab_item_id_pk" PRIMARY KEY("student_id","vocab_item_id"),
	CONSTRAINT "vocab_review_box_range" CHECK ("treoo"."vocab_review"."box" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "treoo"."student_note" ADD CONSTRAINT "student_note_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."student_note" ADD CONSTRAINT "student_note_student_id_app_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "treoo"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."student_note" ADD CONSTRAINT "student_note_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "treoo"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."vocab_item" ADD CONSTRAINT "vocab_item_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."vocab_item" ADD CONSTRAINT "vocab_item_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "treoo"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."vocab_review" ADD CONSTRAINT "vocab_review_academy_id_academy_id_fk" FOREIGN KEY ("academy_id") REFERENCES "treoo"."academy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."vocab_review" ADD CONSTRAINT "vocab_review_student_id_app_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "treoo"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treoo"."vocab_review" ADD CONSTRAINT "vocab_review_vocab_item_id_vocab_item_id_fk" FOREIGN KEY ("vocab_item_id") REFERENCES "treoo"."vocab_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_note_student_idx" ON "treoo"."student_note" USING btree ("academy_id","student_id","created_at");--> statement-breakpoint
CREATE INDEX "vocab_item_lesson_idx" ON "treoo"."vocab_item" USING btree ("academy_id","lesson_id","position");