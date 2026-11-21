ALTER TABLE "totp_secret" ALTER COLUMN "secret_ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "totp_secret" ADD COLUMN "pending_secret_ciphertext" "bytea";--> statement-breakpoint
ALTER TABLE "totp_secret" ADD COLUMN "pending_created_at" timestamp with time zone;