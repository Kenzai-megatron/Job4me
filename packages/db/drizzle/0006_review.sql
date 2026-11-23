CREATE TABLE "past_application" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"company" text,
	"url" text,
	"applied_on" date,
	"source" text DEFAULT 'linkedin' NOT NULL,
	CONSTRAINT "past_application_source_check" CHECK ("past_application"."source" in ('linkedin'))
);
--> statement-breakpoint
ALTER TABLE "past_application" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_offer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"company" text,
	"url" text,
	"saved_on" date,
	"source" text DEFAULT 'linkedin' NOT NULL,
	CONSTRAINT "saved_offer_source_check" CHECK ("saved_offer"."source" in ('linkedin'))
);
--> statement-breakpoint
ALTER TABLE "saved_offer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP VIEW "public"."import_run_ready";--> statement-breakpoint
ALTER TABLE "import_proposal" DROP CONSTRAINT "import_proposal_rubric_check";--> statement-breakpoint
ALTER TABLE "import_proposal" ADD COLUMN "applied_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "past_application" ADD CONSTRAINT "past_application_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_offer" ADD CONSTRAINT "saved_offer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "past_application_user_url_idx" ON "past_application" USING btree ("user_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_offer_user_url_idx" ON "saved_offer" USING btree ("user_id","url");--> statement-breakpoint
ALTER TABLE "import_proposal" ADD CONSTRAINT "import_proposal_rubric_check" CHECK ("import_proposal"."rubric" in ('identity', 'target-jobs', 'experiences', 'facts', 'education', 'certifications', 'skills', 'languages', 'saved-offers', 'past-applications'));--> statement-breakpoint
CREATE VIEW "public"."import_run_done" AS (select "id", "user_id", "updated_at" from "import_run" where ("import_run"."status" in ('applied', 'failed') and "import_run"."extracted" is not null));--> statement-breakpoint
CREATE VIEW "public"."import_run_ready" AS (select "import_run"."id", "import_run"."user_id", "import_run"."status", "import_run"."updated_at" from "import_run" inner join "upload" on "upload"."id" = "import_run"."upload_id" where ("import_run"."status" in ('extracted', 'structuring') and "upload"."kind" in ('cv_pdf', 'cv_docx', 'linkedin_zip')));--> statement-breakpoint
CREATE POLICY "past_application_owner" ON "past_application" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "saved_offer_owner" ON "saved_offer" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);