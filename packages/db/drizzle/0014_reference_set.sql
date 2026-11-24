CREATE TABLE "offer_rating" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"offer_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"note" text,
	CONSTRAINT "offer_rating_rating_check" CHECK ("offer_rating"."rating" between 0 and 100),
	CONSTRAINT "offer_rating_note_check" CHECK ("offer_rating"."note" is null or char_length("offer_rating"."note") <= 200)
);
--> statement-breakpoint
ALTER TABLE "offer_rating" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scoring_benchmark" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"with_claude" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"rated" integer DEFAULT 0 NOT NULL,
	"rules_version" text,
	"rules_mean_gap" double precision,
	"rules_worst" jsonb,
	"claude_rated" integer,
	"claude_mean_gap" double precision,
	"claude_worst" jsonb,
	"quick_model" text,
	"detailed_model" text,
	"prompt_version" text,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"filter_rated" integer,
	"filter_rejected" integer,
	"finished_at" timestamp with time zone,
	CONSTRAINT "scoring_benchmark_status_check" CHECK ("scoring_benchmark"."status" in ('queued', 'running', 'done', 'failed')),
	CONSTRAINT "scoring_benchmark_error_code_check" CHECK ("scoring_benchmark"."error_code" is null or "scoring_benchmark"."error_code" in ('ai_disabled', 'ai_cap_reached', 'ai_refused', 'ai_invalid_output', 'ai_failed', 'no_rating')),
	CONSTRAINT "scoring_benchmark_cost_check" CHECK ("scoring_benchmark"."cost_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "scoring_benchmark" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_call" DROP CONSTRAINT "ai_call_usage_check";--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "offer_rating" ADD CONSTRAINT "offer_rating_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_rating" ADD CONSTRAINT "offer_rating_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_benchmark" ADD CONSTRAINT "scoring_benchmark_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offer_rating_offer_idx" ON "offer_rating" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "offer_rating_user_idx" ON "offer_rating" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "scoring_benchmark_user_idx" ON "scoring_benchmark" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_call" ADD CONSTRAINT "ai_call_usage_check" CHECK ("ai_call"."usage" in ('cv_structuring', 'keywords', 'scoring_quick', 'scoring_detailed', 'scoring_benchmark'));--> statement-breakpoint
CREATE POLICY "offer_rating_owner" ON "offer_rating" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "scoring_benchmark_owner" ON "scoring_benchmark" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);