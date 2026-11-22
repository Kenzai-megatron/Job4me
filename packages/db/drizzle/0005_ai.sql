CREATE TABLE "ai_call" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"usage" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"request_id" text,
	"duration_ms" integer,
	CONSTRAINT "ai_call_usage_check" CHECK ("ai_call"."usage" in ('cv_structuring', 'keywords')),
	CONSTRAINT "ai_call_status_check" CHECK ("ai_call"."status" in ('succeeded', 'refused', 'invalid_output', 'failed', 'blocked', 'disabled')),
	CONSTRAINT "ai_call_cost_check" CHECK ("ai_call"."cost_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_call" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_proposal" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"import_run_id" uuid NOT NULL,
	"rubric" text NOT NULL,
	"source" text NOT NULL,
	"content" "bytea" NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "import_proposal_rubric_check" CHECK ("import_proposal"."rubric" in ('identity', 'target-jobs', 'experiences', 'facts', 'education', 'certifications', 'skills', 'languages')),
	CONSTRAINT "import_proposal_source_check" CHECK ("import_proposal"."source" in ('local', 'ai', 'linkedin')),
	CONSTRAINT "import_proposal_decision_check" CHECK ("import_proposal"."decision" in ('pending', 'accepted', 'corrected', 'ignored'))
);
--> statement-breakpoint
ALTER TABLE "import_proposal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "keyword_proposal_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"proposed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "keyword_proposal_run_status_check" CHECK ("keyword_proposal_run"."status" in ('queued', 'running', 'done', 'failed')),
	CONSTRAINT "keyword_proposal_run_error_code_check" CHECK ("keyword_proposal_run"."error_code" is null or "keyword_proposal_run"."error_code" in ('ai_disabled', 'ai_cap_reached', 'ai_refused', 'ai_invalid_output', 'ai_failed'))
);
--> statement-breakpoint
ALTER TABLE "keyword_proposal_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_run" DROP CONSTRAINT "import_run_error_code_check";--> statement-breakpoint
ALTER TABLE "ai_call" ADD CONSTRAINT "ai_call_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_proposal" ADD CONSTRAINT "import_proposal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_proposal" ADD CONSTRAINT "import_proposal_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_proposal_run" ADD CONSTRAINT "keyword_proposal_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_call_user_id_idx" ON "ai_call" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "import_proposal_run_idx" ON "import_proposal" USING btree ("import_run_id","position");--> statement-breakpoint
CREATE INDEX "keyword_proposal_run_user_id_idx" ON "keyword_proposal_run" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_error_code_check" CHECK ("import_run"."error_code" is null or "import_run"."error_code" in ('unsupported_file', 'file_too_large', 'file_too_complex', 'file_protected', 'file_macros', 'no_text', 'extraction_failed', 'extraction_timeout', 'ai_disabled', 'ai_cap_reached', 'ai_refused', 'ai_invalid_output', 'ai_failed'));--> statement-breakpoint
CREATE VIEW "public"."import_run_ready" AS (select "import_run"."id", "import_run"."user_id", "import_run"."status", "import_run"."updated_at" from "import_run" inner join "upload" on "upload"."id" = "import_run"."upload_id" where ("import_run"."status" in ('extracted', 'structuring') and "upload"."kind" in ('cv_pdf', 'cv_docx')));--> statement-breakpoint
CREATE POLICY "ai_call_owner" ON "ai_call" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "import_proposal_owner" ON "import_proposal" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "keyword_proposal_run_owner" ON "keyword_proposal_run" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);