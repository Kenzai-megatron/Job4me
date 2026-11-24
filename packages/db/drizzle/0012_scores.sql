CREATE TABLE "offer_score" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"offer_id" uuid NOT NULL,
	"method" text NOT NULL,
	"score" integer NOT NULL,
	"confidence" text NOT NULL,
	"factors" jsonb,
	"reason" text,
	"model" text,
	"prompt_version" text,
	"profile_version" text NOT NULL,
	"offer_version" text NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_score_method_check" CHECK ("offer_score"."method" in ('rules', 'claude_quick', 'claude_detailed')),
	CONSTRAINT "offer_score_confidence_check" CHECK ("offer_score"."confidence" in ('low', 'normal')),
	CONSTRAINT "offer_score_score_check" CHECK ("offer_score"."score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "offer_score" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "offer_score" ADD CONSTRAINT "offer_score_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_score" ADD CONSTRAINT "offer_score_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offer_score_offer_idx" ON "offer_score" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "offer_score_user_idx" ON "offer_score" USING btree ("user_id","score");--> statement-breakpoint
CREATE POLICY "offer_score_owner" ON "offer_score" AS PERMISSIVE FOR ALL TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);