CREATE TABLE "import_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"upload_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"extracted_at" timestamp with time zone,
	"extracted" "bytea",
	"stats" jsonb,
	CONSTRAINT "import_run_status_check" CHECK ("import_run"."status" in ('queued', 'extracting', 'extracted', 'structuring', 'review', 'applied', 'failed')),
	CONSTRAINT "import_run_error_code_check" CHECK ("import_run"."error_code" is null or "import_run"."error_code" in ('unsupported_file', 'file_too_large', 'file_too_complex', 'file_protected', 'file_macros', 'no_text', 'extraction_failed', 'extraction_timeout'))
);
--> statement-breakpoint
ALTER TABLE "import_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "upload" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	CONSTRAINT "upload_kind_check" CHECK ("upload"."kind" in ('cv_pdf', 'cv_docx', 'linkedin_zip')),
	CONSTRAINT "upload_sha256_check" CHECK ("upload"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "upload_storage_key_check" CHECK ("upload"."storage_key" ~ '^[A-Za-z0-9_-]{43}$')
);
--> statement-breakpoint
ALTER TABLE "upload" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_upload_id_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."upload"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload" ADD CONSTRAINT "upload_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_run_user_id_idx" ON "import_run" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "import_run_pending_idx" ON "import_run" USING btree ("created_at") WHERE status in ('queued', 'extracting');--> statement-breakpoint
CREATE UNIQUE INDEX "upload_storage_key_idx" ON "upload" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "upload_user_id_idx" ON "upload" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "import_run_owner" ON "import_run" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "import_run_extractor_read" ON "import_run" AS PERMISSIVE FOR SELECT TO "job4me_extractor" USING (true);--> statement-breakpoint
CREATE POLICY "import_run_extractor_update" ON "import_run" AS PERMISSIVE FOR UPDATE TO "job4me_extractor" USING (status in ('queued', 'extracting')) WITH CHECK (status in ('extracting', 'extracted', 'failed'));--> statement-breakpoint
CREATE POLICY "upload_owner" ON "upload" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "upload_extractor" ON "upload" AS PERMISSIVE FOR SELECT TO "job4me_extractor" USING (true);