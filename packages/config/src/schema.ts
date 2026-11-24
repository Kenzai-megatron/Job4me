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

const priceSchema = z.object({
  input: z.number().min(0),
  output: z.number().min(0),
  cacheRead: z.number().min(0),
  cacheWrite: z.number().min(0),
});

const aiTaskSchema = z.object({
  model: z.string().regex(/^claude-[a-z0-9-]+$/),
  maxTokens: z.number().int().min(256).max(64_000),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
});
export type Environment = z.infer<typeof environmentSchema>;

/** Settings of one source (docs/SOURCES.md, section 0; ADR 0014). */
const sourceSettingsSchema = z.object({
  /** ISO weekdays of the scheduled passes, 1 = Monday (decision D3). */
  weekdays: z.array(z.number().int().min(1).max(7)).max(7),
  /** Pause between two requests to this source. */
  pauseMs: z.number().int().min(0).max(120_000),
  /** Time budget of the source within a pass: a slow source returns what it has read. */
  budgetMs: z.number().int().min(1000).max(900_000),
  /** Extra attempts after a network error or a 5xx, never after a 4xx: 0 for pages and LinkedIn. */
  retries: z.number().int().min(0).max(3),
  /** Result pages read per keyword (one in test mode). */
  maxPages: z.number().int().min(1).max(20),
  /** After a 403 or a 429, no call at all for this long (LinkedIn: 24). 0: the next pass tries. */
  cooldownHoursAfterBlock: z
    .number()
    .int()
    .min(0)
    .max(24 * 30),
  enabledByDefault: z.boolean(),
  /** Older ads are neither asked for nor kept (Actiris: 60 days, docs/SOURCES.md). */
  maxAgeDays: z.number().int().min(1).max(365).optional(),
  /** Values of this source only (page size, place name, quota reserve), checked by its connector. */
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type SourceSettings = z.infer<typeof sourceSettingsSchema>;

const timeZoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'must be an IANA time zone such as Europe/Brussels');

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
      /** Extracted text and decided proposals are erased this long after the review. */
      extractedRetentionDays: z.number().int().min(1).max(365),
      extractor: z.object({
        pollIntervalMs: z.number().int().min(100).max(60_000),
        timeoutMs: z.number().int().min(1000).max(600_000),
        memoryMb: z.number().int().min(32).max(4096),
        maxAttempts: z.number().int().min(1).max(10),
        staleAfterMs: z.number().int().min(1000),
      }),
    }),
    ai: z.object({
      /** Hypothèse (plan, decision P4): 2 $ per rolling week and 10 $ for the whole phase. */
      caps: z.object({
        weeklyUsd: z.number().min(0).max(1000),
        totalUsd: z.number().min(0).max(10_000),
      }),
      timeoutMs: z.number().int().min(5000).max(600_000),
      maxRetries: z.number().int().min(0).max(5),
      /** Characters per token when estimating a request before sending it (low = cautious). */
      charsPerToken: z.number().min(1).max(10),
      cvStructuring: aiTaskSchema,
      keywords: aiTaskSchema.extend({
        fallbacks: z.boolean(),
        requestsPerHour: z.number().int().min(1).max(100),
        /** A request still pending after this long no longer blocks a new one. */
        staleAfterMs: z.number().int().min(60_000),
      }),
      structuring: z.object({
        pollIntervalMs: z.number().int().min(500).max(60_000),
        staleAfterMs: z.number().int().min(60_000),
      }),
      /** USD per million tokens, by model; an unknown model (a fallback) is priced at `unknown`. */
      prices: z.record(z.string(), priceSchema),
      unknownModelPrice: priceSchema,
    }),
    /** Job offer collection (phase 2 plan; ADR 0013 to 0015). */
    collect: z.object({
      /** personal, or commercial: every source reserved for personal use is switched off. */
      usageMode: z.enum(['personal', 'commercial']),
      schedule: z.object({ cron: z.string().min(9), timeZone: timeZoneSchema }),
      /** A whole pass, every source included (docs/SOURCES.md, section 1.2). */
      passBudgetMs: z.number().int().min(10_000).max(3_600_000),
      /** A pass still running after this long is marked interrupted (the worker stopped). */
      staleAfterMs: z.number().int().min(60_000),
      http: z.object({
        userAgent: z.string().min(10).max(300),
        acceptLanguage: z.string().min(2).max(100),
        timeoutMs: z.number().int().min(1000).max(120_000),
        maxResponseBytes: z
          .number()
          .int()
          .min(1024)
          .max(50 * 1024 * 1024),
        maxRedirects: z.number().int().min(0).max(10),
        retryBaseMs: z.number().int().min(100).max(60_000),
      }),
      offers: z.object({
        maxDescriptionChars: z.number().int().min(100).max(10_000),
        /** An offer not seen for this long is deleted (ADR 0015). */
        retentionDays: z.number().int().min(7).max(3650),
        /**
         * A new posting is compared with the announcements seen this recently (ADR 0016): past
         * it, the same offer seen again is a new announcement.
         */
        historyDays: z.number().int().min(1).max(365),
        listLimit: z.number().int().min(1).max(100),
      }),
      runs: z.object({
        /** Pass logs are kept this long (ADR 0015). */
        retentionDays: z.number().int().min(30).max(3650),
        /** Latest runs shown on each source of the Sources screen. */
        perSource: z.number().int().min(1).max(50),
        /** The window of the figures of each source (SPEC section 9: four weeks). */
        windowDays: z.number().int().min(1).max(365),
      }),
      /** Silent source (decision D4): what raises the alert. */
      mute: z.object({
        /** Previous runs whose median read count is the usual volume. */
        history: z.number().int().min(3).max(30),
        /** Below this usual volume, a drop says nothing (too few offers to judge). */
        minUsual: z.number().int().min(1).max(10_000),
        /** A run reading less than this share of the usual volume is a collapse. */
        collapseRatio: z.number().min(0).max(1),
      }),
      manual: z.object({
        maxTextChars: z.number().int().min(100).max(50_000),
        addsPerHour: z.number().int().min(1).max(500),
      }),
      test: z.object({ requestsPerHour: z.number().int().min(1).max(60) }),
      /** Development and tests: the demo source (no request at all) replaces the real ones. */
      demoSource: z.boolean(),
      /**
       * The city of the sites searched by city name (StepStone, Talent.com), and the centre of
       * the searches around a point (Forem) while the profile's base city is not found in the
       * localities (ADR 0017).
       */
      area: z.object({
        name: z.string().min(1).max(100),
        lat: z.number().min(49).max(52),
        lon: z.number().min(2).max(7),
      }),
      sources: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,31}$/), sourceSettingsSchema),
    }),
    /** Geography (ADR 0017; docs/SOURCES.md, section 1.7). */
    geo: z.object({
      /** Road distance from the straight line: 1.25 on average in Belgium. */
      roadFactor: z.number().min(1).max(3),
      /** A place name carried by two places further apart than this is not guessed. */
      ambiguityKm: z.number().min(1).max(100),
      /** Four figures in this range are years, not postal codes. */
      yearsFrom: z.number().int().min(1000).max(9999),
      yearsTo: z.number().int().min(1000).max(9999),
    }),
    backups: z.object({
      /** The most recent backups kept, then one a week for this many weeks (ADR 0012). */
      keepDaily: z.number().int().min(1).max(365),
      keepWeekly: z.number().int().min(0).max(520),
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
    if (settings.collect.staleAfterMs <= settings.collect.passBudgetMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['collect', 'staleAfterMs'],
        message: 'must be greater than passBudgetMs, or a running pass would be marked interrupted',
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
  /** Claude API key (ADR 0009): on the home machine only; empty or absent, the AI is off. */
  anthropicApiKey: string | undefined;
  /** Keys of the job sources that need one (ADR 0014): empty or absent, the source is skipped. */
  sourceKeys: Record<string, string | undefined>;
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
