import { z } from 'zod';

// Bounds only: every value lives in config/default.yaml (ADR 0005).

const origin = z.url({ protocol: /^https?$/ }).refine((value) => new URL(value).origin === value, {
  message: 'must be a bare origin such as https://host or http://localhost:5173',
});

const port = z.number().int().min(1).max(65535);

export const MAILPIT_HOSTS = ['127.0.0.1', 'localhost', 'mailpit'] as const;

export const environmentSchema = z.enum(['development', 'test', 'production']);
export type Environment = z.infer<typeof environmentSchema>;

export const settingsSchema = z
  .object({
    app: z.object({
      publicOrigin: origin,
      extraOrigins: z.array(origin).max(10),
      rpId: z.string().min(1).max(253),
      rpName: z.string().min(1).max(64),
      listenHost: z.string().min(1),
      listenPort: port,
    }),
    auth: z.object({
      session: z.object({
        idleTimeoutMinutes: z
          .number()
          .int()
          .min(5)
          .max(60 * 24 * 7),
        absoluteTimeoutHours: z
          .number()
          .int()
          .min(1)
          .max(24 * 30),
        reauthWindowMinutes: z.number().int().min(1).max(30),
        touchIntervalSeconds: z.number().int().min(5).max(3600),
      }),
      enrollmentLinkMinutes: z
        .number()
        .int()
        .min(5)
        .max(60 * 24),
      challengeMinutes: z.number().int().min(1).max(15),
      passwordStepMinutes: z.number().int().min(1).max(15),
      password: z.object({
        minLength: z.number().int().min(12).max(64),
        maxLength: z.number().int().min(64).max(1024),
        argon2: z.object({
          memoryKiB: z.number().int().min(19456).max(1048576),
          iterations: z.number().int().min(2).max(10),
          parallelism: z.number().int().min(1).max(16),
        }),
      }),
      lockout: z.object({
        threshold: z.number().int().min(3).max(20),
        baseDelaySeconds: z.number().int().min(10).max(3600),
        maxDelaySeconds: z
          .number()
          .int()
          .min(60)
          .max(60 * 60 * 24),
      }),
      rateLimit: z.object({
        authRequestsPerMinute: z.number().int().min(5).max(600),
      }),
      totp: z.object({
        issuer: z.string().min(1).max(64),
        window: z.number().int().min(0).max(2),
      }),
      recoveryCodes: z.object({
        count: z.number().int().min(8).max(16),
      }),
    }),
    http: z.object({
      bodyLimitBytes: z
        .number()
        .int()
        .min(1024)
        .max(10 * 1024 * 1024),
    }),
    mail: z.object({
      smtpHost: z.string().min(1),
      smtpPort: port,
    }),
    push: z.object({
      vapidSubject: z
        .string()
        .regex(/^(mailto:\S+@\S+|https:\/\/\S+)$/, 'must be a mailto: or https: address'),
    }),
    worker: z.object({
      purgeCron: z.string().min(9),
      expiredSessionRetentionDays: z.number().int().min(1).max(365),
      consumedTokenRetentionDays: z.number().int().min(1).max(365),
    }),
  })
  .superRefine((settings, ctx) => {
    if (settings.auth.lockout.maxDelaySeconds < settings.auth.lockout.baseDelaySeconds) {
      ctx.addIssue({
        code: 'custom',
        path: ['auth', 'lockout', 'maxDelaySeconds'],
        message: 'must be greater than or equal to baseDelaySeconds',
      });
    }
    const host = new URL(settings.app.publicOrigin).hostname;
    if (host !== settings.app.rpId && !host.endsWith(`.${settings.app.rpId}`)) {
      ctx.addIssue({
        code: 'custom',
        path: ['app', 'rpId'],
        message: `must be the host of publicOrigin (${host}) or one of its parent domains`,
      });
    }
  });

export type Settings = z.infer<typeof settingsSchema>;

export interface Secrets {
  /** Runtime connection string (job4me_app role). */
  databaseUrl: string;
  /** Owner connection string, used by migrations only. */
  databaseOwnerUrl: string | undefined;
  /** 32-byte master key, base64. */
  masterKey: string;
  vapidPublicKey: string | undefined;
  vapidPrivateKey: string | undefined;
}

export interface Config {
  env: Environment;
  settings: Settings;
  /** Origins accepted on state-changing requests and WebAuthn ceremonies. */
  allowedOrigins: string[];
}
