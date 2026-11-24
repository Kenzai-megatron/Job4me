CREATE TABLE "document_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"document_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"origin" text NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "document_version_number_check" CHECK ("document_version"."number" >= 1),
	CONSTRAINT "document_version_origin_check" CHECK ("document_version"."origin" in ('profile', 'layout', 'manual', 'template', 'claude'))
);
--> statement-breakpoint
ALTER TABLE "document_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"master_cv_id" uuid,
	"kind" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_kind_check" CHECK ("document"."kind" in ('cv', 'letter', 'mail')),
	CONSTRAINT "document_current_version_check" CHECK ("document"."current_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "master_cv" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"target_job_id" uuid NOT NULL,
	"template" text DEFAULT 'classic' NOT NULL,
	"language" text DEFAULT 'fr' NOT NULL,
	"layout" jsonb NOT NULL,
	CONSTRAINT "master_cv_template_check" CHECK ("master_cv"."template" in ('classic', 'modern')),
	CONSTRAINT "master_cv_language_check" CHECK ("master_cv"."language" in ('fr', 'nl', 'en'))
);
--> statement-breakpoint
ALTER TABLE "master_cv" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_master_cv_id_master_cv_id_fk" FOREIGN KEY ("master_cv_id") REFERENCES "public"."master_cv"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_cv" ADD CONSTRAINT "master_cv_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_cv" ADD CONSTRAINT "master_cv_target_job_id_target_job_id_fk" FOREIGN KEY ("target_job_id") REFERENCES "public"."target_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_version_number_idx" ON "document_version" USING btree ("document_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "document_master_cv_idx" ON "document" USING btree ("master_cv_id","kind");--> statement-breakpoint
CREATE INDEX "document_user_idx" ON "document" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "master_cv_target_job_idx" ON "master_cv" USING btree ("target_job_id");--> statement-breakpoint
CREATE INDEX "master_cv_user_idx" ON "master_cv" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "document_version_owner" ON "document_version" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_owner" ON "document" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "master_cv_owner" ON "master_cv" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);