ALTER TABLE "source_setting" ADD COLUMN "alert" text;--> statement-breakpoint
ALTER TABLE "source_setting" ADD COLUMN "alert_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_setting" ADD COLUMN "alert_read" integer;--> statement-breakpoint
ALTER TABLE "source_setting" ADD COLUMN "alert_usual" integer;--> statement-breakpoint
ALTER TABLE "source_setting" ADD COLUMN "alert_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_setting" ADD CONSTRAINT "source_setting_alert_check" CHECK ("source_setting"."alert" is null or "source_setting"."alert" in ('zero_read', 'collapse'));