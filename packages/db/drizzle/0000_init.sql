CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_log_actor_type_check" CHECK ("audit_log"."actor_type" in ('user', 'cli', 'system')),
	CONSTRAINT "audit_log_outcome_check" CHECK ("audit_log"."outcome" in ('success', 'failure', 'denied'))
);
--> statement-breakpoint
CREATE TABLE "auth_challenge" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"purpose" text NOT NULL,
	"challenge" text,
	"binding_hash" "bytea" NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_challenge_purpose_check" CHECK ("auth_challenge"."purpose" in ('registration', 'authentication', 'reauth', 'password_verified'))
);
--> statement-breakpoint
CREATE TABLE "auth_throttle" (
	"user_id" uuid NOT NULL,
	"factor" text NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	CONSTRAINT "auth_throttle_user_id_factor_pk" PRIMARY KEY("user_id","factor"),
	CONSTRAINT "auth_throttle_factor_check" CHECK ("auth_throttle"."factor" in ('password', 'totp', 'recovery'))
);
--> statement-breakpoint
CREATE TABLE "one_time_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_time_token_purpose_check" CHECK ("one_time_token"."purpose" in ('enrollment'))
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"sign_count" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"aaguid" uuid,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkey_device_type_check" CHECK ("passkey"."device_type" in ('singleDevice', 'multiDevice'))
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recovery_code" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"code_hmac" "bytea" NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"auth_method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"reauthenticated_at" timestamp with time zone NOT NULL,
	"user_agent_label" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "session_auth_method_check" CHECK ("session"."auth_method" in ('passkey', 'password_totp', 'password_recovery'))
);
--> statement-breakpoint
CREATE TABLE "totp_secret" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_used_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"locale" text DEFAULT 'fr-BE' NOT NULL,
	"time_zone" text DEFAULT 'Europe/Brussels' NOT NULL,
	"webauthn_user_handle" "bytea" NOT NULL,
	"password_hash" text,
	"password_fallback_enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_check" CHECK ("user"."role" in ('owner', 'member')),
	CONSTRAINT "user_status_check" CHECK ("user"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "auth_challenge" ADD CONSTRAINT "auth_challenge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_throttle" ADD CONSTRAINT "auth_throttle_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_token" ADD CONSTRAINT "one_time_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_secret" ADD CONSTRAINT "totp_secret_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "auth_challenge_binding_idx" ON "auth_challenge" USING btree ("binding_hash","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "one_time_token_hash_idx" ON "one_time_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "one_time_token_user_id_idx" ON "one_time_token" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_id_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscription_endpoint_idx" ON "push_subscription" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscription_user_id_idx" ON "push_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_code_user_hmac_idx" ON "recovery_code" USING btree ("user_id","code_hmac");--> statement-breakpoint
CREATE INDEX "recovery_code_user_id_idx" ON "recovery_code" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_hash_idx" ON "session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_lower_idx" ON "user" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "user_webauthn_user_handle_idx" ON "user" USING btree ("webauthn_user_handle");