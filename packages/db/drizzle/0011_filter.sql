ALTER TABLE "profile" ADD COLUMN "scoring_instructions" text;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "scoring_weights" jsonb;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "contracts" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "languages" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "excluded_reason" text;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "screened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_excluded_reason_check" CHECK ("offer"."excluded_reason" is null or "offer"."excluded_reason" in ('excluded_company', 'too_old', 'abroad', 'too_far', 'language', 'contract'));