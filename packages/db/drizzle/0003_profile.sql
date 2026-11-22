CREATE TABLE "certification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"issuer" text,
	"year" integer
);
--> statement-breakpoint
ALTER TABLE "certification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "education" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"degree" text NOT NULL,
	"institution" text NOT NULL,
	"year" integer
);
--> statement-breakpoint
ALTER TABLE "education" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "elimination_rule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "elimination_rule_kind_check" CHECK ("elimination_rule"."kind" in ('language', 'sector', 'schedule', 'travel', 'other'))
);
--> statement-breakpoint
ALTER TABLE "elimination_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "excluded_company" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "excluded_company" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "experience" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"employer" text NOT NULL,
	"location" text,
	"start_month" text,
	"end_month" text,
	"current" boolean DEFAULT false NOT NULL,
	"description" text,
	CONSTRAINT "experience_start_month_check" CHECK ("experience"."start_month" is null or "experience"."start_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "experience_end_month_check" CHECK ("experience"."end_month" is null or "experience"."end_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "experience" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fact" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"experience_id" uuid,
	"text" text NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "fact_origin_check" CHECK ("fact"."origin" in ('manual', 'cv_import', 'linkedin_import'))
);
--> statement-breakpoint
ALTER TABLE "fact" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "language_level" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"language" text NOT NULL,
	"overall" text NOT NULL,
	"understanding" text,
	"speaking" text,
	"writing" text,
	CONSTRAINT "language_level_overall_check" CHECK ("language_level"."overall" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
	CONSTRAINT "language_level_understanding_check" CHECK ("language_level"."understanding" is null or "language_level"."understanding" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
	CONSTRAINT "language_level_speaking_check" CHECK ("language_level"."speaking" is null or "language_level"."speaking" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
	CONSTRAINT "language_level_writing_check" CHECK ("language_level"."writing" is null or "language_level"."writing" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'))
);
--> statement-breakpoint
ALTER TABLE "language_level" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile_identity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ciphertext" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_identity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"motivations" text,
	"motivation_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"base_city" text,
	"base_postal_code" text,
	"radius_km" integer,
	"contract_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"work_regimes" text[] DEFAULT '{}'::text[] NOT NULL,
	"remote_preference" text,
	"salary_min_monthly" integer,
	"available_from" text
);
--> statement-breakpoint
ALTER TABLE "profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "search_keyword" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"keyword" text NOT NULL,
	"language" text NOT NULL,
	"priority" boolean DEFAULT false NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'validated' NOT NULL,
	CONSTRAINT "search_keyword_language_check" CHECK ("search_keyword"."language" in ('fr', 'nl', 'en')),
	CONSTRAINT "search_keyword_origin_check" CHECK ("search_keyword"."origin" in ('ai', 'manual', 'import')),
	CONSTRAINT "search_keyword_status_check" CHECK ("search_keyword"."status" in ('proposed', 'validated', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "search_keyword" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sector_preference" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sector" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "sector_preference_kind_check" CHECK ("sector_preference"."kind" in ('preferred', 'accepted', 'excluded'))
);
--> statement-breakpoint
ALTER TABLE "sector_preference" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "skill" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"level" text,
	"years" numeric(4, 1),
	CONSTRAINT "skill_level_check" CHECK ("skill"."level" is null or "skill"."level" in ('beginner', 'intermediate', 'advanced', 'expert'))
);
--> statement-breakpoint
ALTER TABLE "skill" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "target_job" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "target_job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "title_filter_rule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"list" text NOT NULL,
	"expression" text NOT NULL,
	CONSTRAINT "title_filter_rule_list_check" CHECK ("title_filter_rule"."list" in ('keep', 'reject', 'always'))
);
--> statement-breakpoint
ALTER TABLE "title_filter_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "certification" ADD CONSTRAINT "certification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education" ADD CONSTRAINT "education_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elimination_rule" ADD CONSTRAINT "elimination_rule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excluded_company" ADD CONSTRAINT "excluded_company_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience" ADD CONSTRAINT "experience_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_experience_id_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experience"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_level" ADD CONSTRAINT "language_level_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_identity" ADD CONSTRAINT "profile_identity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_keyword" ADD CONSTRAINT "search_keyword_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_preference" ADD CONSTRAINT "sector_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_job" ADD CONSTRAINT "target_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_filter_rule" ADD CONSTRAINT "title_filter_rule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certification_user_id_idx" ON "certification" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "education_user_id_idx" ON "education" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "elimination_rule_user_id_idx" ON "elimination_rule" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "excluded_company_user_id_idx" ON "excluded_company" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "experience_user_id_idx" ON "experience" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fact_user_id_idx" ON "fact" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "language_level_unique_idx" ON "language_level" USING btree ("user_id","language");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_identity_user_id_idx" ON "profile_identity" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_user_id_idx" ON "profile" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_keyword_unique_idx" ON "search_keyword" USING btree ("user_id","language",lower("keyword"));--> statement-breakpoint
CREATE INDEX "sector_preference_user_id_idx" ON "sector_preference" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skill_user_id_idx" ON "skill" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "target_job_user_id_idx" ON "target_job" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "title_filter_rule_user_id_idx" ON "title_filter_rule" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "certification_owner" ON "certification" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "education_owner" ON "education" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "elimination_rule_owner" ON "elimination_rule" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "excluded_company_owner" ON "excluded_company" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "experience_owner" ON "experience" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fact_owner" ON "fact" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "language_level_owner" ON "language_level" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "profile_identity_owner" ON "profile_identity" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "profile_owner" ON "profile" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "search_keyword_owner" ON "search_keyword" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sector_preference_owner" ON "sector_preference" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "skill_owner" ON "skill" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "target_job_owner" ON "target_job" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "title_filter_rule_owner" ON "title_filter_rule" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);