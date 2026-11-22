import { z } from 'zod';

// Bounds only: every value lives in config/default.yaml (ADR 0005).

const origin = z.url({ protocol: /^https?$/ }).refine((value) => new URL(value).origin === value, {
  message: 'must be a bare origin such as https://host or http://localhost:5173',
});

const port = z.number().int().min(1).max(65535);

export const MAILPIT_HOSTS = ['127.0.0.1', 'localhost', 'mailpit'] as const;

/** Rubrics counted by the profile completeness (same list as @job4me/contracts). */
export const completenessRubrics = [
  'identity',
  'practical',
  'motivations',
  'targetJobs',
  'keywords',
  'experiences',
  'facts',
  'skills',
  'languages',
  'education',
] as const;

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
      from: z.string().min(3).max(320),
    }),
    push: z.object({
      vapidSubject: z
        .string()
        .regex(/^(mailto:\S+@\S+|https:\/\/\S+)$/, 'must be a mailto: or https: address'),
      testRequestsPerMinute: z.number().int().min(1).max(60),
    }),
    profile: z.object({
      defaultRadiusKm: z.number().int().min(1).max(300),
      maxTargetJobs: z.number().int().min(1).max(10),
      keywords: z.object({
        min: z.number().int().min(1).max(100),
        max: z.number().int().min(1).max(200),
        priority: z.number().int().min(1).max(50),
      }),
      completeness: z.record(
        z.enum(completenessRubrics),
        z.object({ weight: z.number().int().min(0).max(100), min: z.number().int().min(1) }),
      ),
    }),
    files: z.object({
      /** Directory of the files volume; imported files go under imports/ (ADR 0010). */
      dir: z.string().min(1),
    }),
    imports: z.object({
      maxFileBytes: z
        .number()
        .int()
        .min(1024)
        .max(50 * 1024 * 1024),
      uploadsPerHour: z.number().int().min(1).max(1000),
      listLimit: z.number().int().min(1).max(200),
      archive: z.object({
        maxEntries: z.number().int().min(1).max(100_000),
        maxTotalUncompressedBytes: z.number().int().min(1024),
        maxEntryUncompressedBytes: z.number().int().min(1024),
        maxCompressionRatio: z.number().min(1).max(1100),
        minRatioCheckBytes: z.number().int().min(0),
      }),
      maxPdfPages: z.number().int().min(1).max(1000),
      maxExtractedChars: z.number().int().min(1000),
      maxLinkedinRows: z.number().int().min(1),
      extractor: z.object({
        pollIntervalMs: z.number().int().min(100).max(60_000),
        timeoutMs: z.number().int().min(1000).max(600_000),
        memoryMb: z.number().int().min(32).max(4096),
        maxAttempts: z.number().int().min(1).max(10),
        staleAfterMs: z.number().int().min(1000),
      }),
    }),
    worker: z.object({
      purgeCron: z.string().min(9),
      expiredSessionRetentionDays: z.number().int().min(1).max(365),
      consumedTokenRetentionDays: z.number().int().min(1).max(365),
    }),
  })
  .superRefine((settings, ctx) => {
    const weights = Object.values(settings.profile.completeness).reduce(
      (sum, rubric) => sum + rubric.weight,
      0,
    );
    if (weights !== 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['profile', 'completeness'],
        message: `weights must add up to 100, not ${weights}`,
      });
    }
    const { extractor } = settings.imports;
    if (extractor.staleAfterMs <= extractor.timeoutMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['imports', 'extractor', 'staleAfterMs'],
        message: 'must be greater than timeoutMs, or a running extraction would be started twice',
      });
    }
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
  /** Isolated extractor's connection string (job4me_extractor role), for migrations and tests. */
  databaseExtractorUrl: string | undefined;
  /** 32-byte key of imported files and extracted texts, base64 (ADR 0010), apart from the master key. */
  importKey: string | undefined;
  vapidPublicKey: string | undefined;
  vapidPrivateKey: string | undefined;
}

/** What the isolated extractor receives (ADR 0010): never the master key. */
export interface ExtractorSecrets {
  databaseUrl: string;
  importKey: string;
}

export interface Config {
  env: Environment;
  settings: Settings;
  /** Origins accepted on state-changing requests and WebAuthn ceremonies. */
  allowedOrigins: string[];
}
