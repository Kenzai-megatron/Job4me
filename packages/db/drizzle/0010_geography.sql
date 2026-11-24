CREATE TABLE "dataset" (
	"name" text PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"rows" integer NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locality" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"names" text[] DEFAULT '{}'::text[] NOT NULL,
	"postal_codes" text[] NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"region" text NOT NULL,
	"province" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "place_status" text;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "place_name" text;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "remote" text;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "place_status" text;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "place_name" text;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "remote" text;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "distance_km" integer;--> statement-breakpoint
CREATE INDEX "locality_name_idx" ON "locality" USING btree ("name");--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_place_status_check" CHECK ("job_offer"."place_status" is null or "job_offer"."place_status" in ('found', 'unknown', 'abroad'));--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_remote_check" CHECK ("job_offer"."remote" is null or "job_offer"."remote" in ('full', 'hybrid'));--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_postal_code_check" CHECK ("job_offer"."postal_code" is null or "job_offer"."postal_code" ~ '^[0-9]{4}$');--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_place_status_check" CHECK ("offer"."place_status" is null or "offer"."place_status" in ('found', 'unknown', 'abroad'));--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_remote_check" CHECK ("offer"."remote" is null or "offer"."remote" in ('full', 'hybrid'));--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_postal_code_check" CHECK ("offer"."postal_code" is null or "offer"."postal_code" ~ '^[0-9]{4}$');--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_distance_check" CHECK ("offer"."distance_km" is null or "offer"."distance_km" >= 0);