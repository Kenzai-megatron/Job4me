CREATE TABLE "offer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retained_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_run" DROP CONSTRAINT "source_run_counts_check";--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "offer_id" uuid;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "content_key" text;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "bare_title" text;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "title_refs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "dedup_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "merge_reason" text;--> statement-breakpoint
ALTER TABLE "source_run" ADD COLUMN "merged_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Postings of phase 2 (ADR 0016): one announcement each, under the posting's own identifier.
-- The worker identifies them at start-up and regroups those that are the same announcement.
INSERT INTO "offer" ("id", "user_id", "created_at", "updated_at", "retained_id", "first_seen_at", "last_seen_at")
  SELECT "id", "user_id", "created_at", "updated_at", "id", "first_seen_at", "last_seen_at" FROM "job_offer";--> statement-breakpoint
UPDATE "job_offer" SET "offer_id" = "id";--> statement-breakpoint
ALTER TABLE "job_offer" ALTER COLUMN "offer_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_retained_id_job_offer_id_fk" FOREIGN KEY ("retained_id") REFERENCES "public"."job_offer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offer_user_first_seen_idx" ON "offer" USING btree ("user_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "offer_user_last_seen_idx" ON "offer" USING btree ("user_id","last_seen_at");--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_offer_offer_idx" ON "job_offer" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "job_offer_user_key_idx" ON "job_offer" USING btree ("user_id","content_key");--> statement-breakpoint
CREATE INDEX "job_offer_user_bare_idx" ON "job_offer" USING btree ("user_id","bare_title");--> statement-breakpoint
CREATE INDEX "job_offer_user_version_idx" ON "job_offer" USING btree ("user_id","dedup_version");--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_merge_reason_check" CHECK ("job_offer"."merge_reason" is null or "job_offer"."merge_reason" in ('key', 'reference', 'url', 'employer', 'no_employer'));--> statement-breakpoint
ALTER TABLE "source_run" ADD CONSTRAINT "source_run_counts_check" CHECK ("source_run"."read_count" >= 0 and "source_run"."kept_count" >= 0 and "source_run"."new_count" >= 0 and "source_run"."merged_count" >= 0 and "source_run"."invalid_count" >= 0 and "source_run"."request_count" >= 0);--> statement-breakpoint
CREATE POLICY "offer_owner" ON "offer" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);