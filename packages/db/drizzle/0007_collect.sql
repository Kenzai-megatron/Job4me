CREATE TABLE "collection_pass" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "collection_pass_trigger_check" CHECK ("collection_pass"."trigger" in ('scheduled', 'manual', 'test')),
	CONSTRAINT "collection_pass_status_check" CHECK ("collection_pass"."status" in ('queued', 'running', 'done', 'interrupted'))
);
--> statement-breakpoint
ALTER TABLE "collection_pass" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_offer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"origin" text DEFAULT 'collected' NOT NULL,
	"title" text NOT NULL,
	"company" text DEFAULT '?' NOT NULL,
	"location" text DEFAULT '?' NOT NULL,
	"posted_on" date,
	"url" text,
	"salary" text,
	"description" text DEFAULT '' NOT NULL,
	"details" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_offer_source_check" CHECK ("job_offer"."source" ~ '^[a-z][a-z0-9_]{1,31}$'),
	CONSTRAINT "job_offer_origin_check" CHECK ("job_offer"."origin" in ('collected', 'manual')),
	CONSTRAINT "job_offer_url_check" CHECK ("job_offer"."url" is null or "job_offer"."url" ~* '^https?://'),
	CONSTRAINT "job_offer_length_check" CHECK (char_length("job_offer"."title") between 1 and 300 and char_length("job_offer"."description") <= 50000)
);
--> statement-breakpoint
ALTER TABLE "job_offer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pass_id" uuid NOT NULL,
	"source" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"skip_reason" text,
	"error_code" text,
	"http_status" integer,
	"read_count" integer DEFAULT 0 NOT NULL,
	"kept_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "source_run_source_check" CHECK ("source_run"."source" ~ '^[a-z][a-z0-9_]{1,31}$'),
	CONSTRAINT "source_run_trigger_check" CHECK ("source_run"."trigger" in ('scheduled', 'manual', 'test')),
	CONSTRAINT "source_run_status_check" CHECK ("source_run"."status" in ('running', 'succeeded', 'partial', 'failed', 'skipped')),
	CONSTRAINT "source_run_skip_reason_check" CHECK ("source_run"."skip_reason" is null or "source_run"."skip_reason" in ('disabled', 'commercial_mode', 'cooldown', 'missing_key', 'no_keywords', 'quota', 'pass_budget')),
	CONSTRAINT "source_run_skipped_check" CHECK (("source_run"."status" = 'skipped') = ("source_run"."skip_reason" is not null)),
	CONSTRAINT "source_run_error_code_check" CHECK ("source_run"."error_code" is null or "source_run"."error_code" in ('blocked', 'http_error', 'network_error', 'timeout', 'too_large', 'invalid_response', 'host_not_allowed', 'budget_exceeded', 'connector_error', 'interrupted')),
	CONSTRAINT "source_run_counts_check" CHECK ("source_run"."read_count" >= 0 and "source_run"."kept_count" >= 0 and "source_run"."new_count" >= 0 and "source_run"."invalid_count" >= 0 and "source_run"."request_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "source_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_setting" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"enabled" boolean,
	"cooldown_until" timestamp with time zone,
	"quota_remaining" integer,
	"quota_checked_at" timestamp with time zone,
	CONSTRAINT "source_setting_source_check" CHECK ("source_setting"."source" ~ '^[a-z][a-z0-9_]{1,31}$')
);
--> statement-breakpoint
ALTER TABLE "source_setting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collection_pass" ADD CONSTRAINT "collection_pass_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_run" ADD CONSTRAINT "source_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_run" ADD CONSTRAINT "source_run_pass_id_collection_pass_id_fk" FOREIGN KEY ("pass_id") REFERENCES "public"."collection_pass"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_setting" ADD CONSTRAINT "source_setting_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_pass_user_idx" ON "collection_pass" USING btree ("user_id","trigger","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_offer_user_source_external_idx" ON "job_offer" USING btree ("user_id","source","external_id");--> statement-breakpoint
CREATE INDEX "job_offer_user_first_seen_idx" ON "job_offer" USING btree ("user_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "job_offer_user_last_seen_idx" ON "job_offer" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "source_run_user_source_idx" ON "source_run" USING btree ("user_id","source","created_at");--> statement-breakpoint
CREATE INDEX "source_run_pass_idx" ON "source_run" USING btree ("pass_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_setting_user_source_idx" ON "source_setting" USING btree ("user_id","source");--> statement-breakpoint
CREATE POLICY "collection_pass_owner" ON "collection_pass" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "job_offer_owner" ON "job_offer" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "source_run_owner" ON "source_run" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "source_setting_owner" ON "source_setting" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);