ALTER TABLE "ai_call" DROP CONSTRAINT "ai_call_usage_check";--> statement-breakpoint
ALTER TABLE "offer_score" ADD COLUMN "analysis" jsonb;--> statement-breakpoint
ALTER TABLE "ai_call" ADD CONSTRAINT "ai_call_usage_check" CHECK ("ai_call"."usage" in ('cv_structuring', 'keywords', 'scoring_quick', 'scoring_detailed'));