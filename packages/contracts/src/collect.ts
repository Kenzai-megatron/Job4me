import { z } from 'zod';

// Job offer collection (phase 2 plan, sections 3, 4 and 8; ADR 0013 to 0015).

/** A source's machine name: its connector's, also the key of its settings. */
export const sourceNameSchema = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);

/** How a source is reached. LinkedIn guest and public pages are personal use only (ADR 0014). */
export const sourceAccesses = [
  'open_data',
  'api',
  'public_page',
  'linkedin_guest',
  'demo',
] as const;
export type SourceAccess = (typeof sourceAccesses)[number];

/** By keywords (the site's search sorts) or a fixed list read in full (the title filter sorts). */
export const sourceFamilies = ['keywords', 'fixed_list'] as const;
export type SourceFamily = (typeof sourceFamilies)[number];

/** The whole keyword list, or only the priority ones for rationed or slow sources. */
export const keywordLevels = ['full', 'priority'] as const;
export type KeywordLevel = (typeof keywordLevels)[number];

/** `commercial` switches off every source reserved for personal use (ADR 0014). */
export const usageModes = ['personal', 'commercial'] as const;
export type UsageMode = (typeof usageModes)[number];

export const passTriggers = ['scheduled', 'manual', 'test'] as const;
export type PassTrigger = (typeof passTriggers)[number];

export const passStatuses = ['queued', 'running', 'done', 'interrupted'] as const;
export type PassStatus = (typeof passStatuses)[number];

export const runStatuses = ['running', 'succeeded', 'partial', 'failed', 'skipped'] as const;
export type RunStatus = (typeof runStatuses)[number];

/** Why a source was deliberately not called: "skipped", never "0 offers" (ADR 0013). */
export const skipReasons = [
  'disabled',
  'commercial_mode',
  'cooldown',
  'missing_key',
  'no_keywords',
  'quota',
  'pass_budget',
] as const;
export type SkipReason = (typeof skipReasons)[number];

/** Why a source failed, without any URL or page content (plan, section 9, threat 3). */
export const collectErrorCodes = [
  'blocked',
  'http_error',
  'network_error',
  'timeout',
  'too_large',
  'invalid_response',
  'host_not_allowed',
  'budget_exceeded',
  'connector_error',
  'interrupted',
] as const;
export type CollectErrorCode = (typeof collectErrorCodes)[number];

/** One source in one pass: read before any filter, kept after the title filter, new among those. */
export const sourceRunSchema = z.object({
  id: z.uuid(),
  passId: z.uuid(),
  source: sourceNameSchema,
  trigger: z.enum(passTriggers),
  status: z.enum(runStatuses),
  skipReason: z.enum(skipReasons).nullable(),
  errorCode: z.enum(collectErrorCodes).nullable(),
  httpStatus: z.number().int().nullable(),
  readCount: z.number().int().min(0),
  keptCount: z.number().int().min(0),
  newCount: z.number().int().min(0),
  invalidCount: z.number().int().min(0),
  requestCount: z.number().int().min(0),
  durationMs: z.number().int().min(0).nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type SourceRun = z.infer<typeof sourceRunSchema>;

export const sourceSummarySchema = z.object({
  name: sourceNameSchema,
  access: z.enum(sourceAccesses),
  family: z.enum(sourceFamilies),
  keywordLevel: z.enum(keywordLevels),
  personalUseOnly: z.boolean(),
  /** ISO weekdays of the scheduled passes (1 = Monday). */
  weekdays: z.array(z.number().int().min(1).max(7)),
  /** The switch as Mehdi set it (or the default of the configuration). */
  enabled: z.boolean(),
  /** In commercial mode, a personal-use source can neither be switched on nor run. */
  locked: z.boolean(),
  /** No call before this time, after a 403 or a 429 (LinkedIn: 24 hours). */
  cooldownUntil: z.string().nullable(),
  /** The latest runs, newest first (tests included). */
  runs: z.array(sourceRunSchema),
});
export type SourceSummary = z.infer<typeof sourceSummarySchema>;

export const sourcesResponseSchema = z.object({
  usageMode: z.enum(usageModes),
  sources: z.array(sourceSummarySchema),
});
export type SourcesResponse = z.infer<typeof sourcesResponseSchema>;

export const sourceParamsSchema = z.object({ name: sourceNameSchema });
export const sourceToggleSchema = z.object({ enabled: z.boolean() });
export const sourceRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const sourceRunsResponseSchema = z.object({ runs: z.array(sourceRunSchema) });

export const passSchema = z.object({
  id: z.uuid(),
  trigger: z.enum(passTriggers),
  status: z.enum(passStatuses),
  sources: z.array(sourceNameSchema),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  runs: z.array(sourceRunSchema),
});
export type CollectionPass = z.infer<typeof passSchema>;

/** "Test the sources": one keyword, one page per source; it writes its log, never offers. */
export const sourceTestRequestSchema = z.object({
  sources: z.array(sourceNameSchema).min(1).max(30).optional(),
});
export const latestTestResponseSchema = z.object({ pass: passSchema.nullable() });

export const offerOrigins = ['collected', 'manual'] as const;
export type OfferOrigin = (typeof offerOrigins)[number];

/** An offer in the common format (docs/SOURCES.md, section 1.1); "?" stands for unknown. */
export const offerSchema = z.object({
  id: z.uuid(),
  source: sourceNameSchema,
  origin: z.enum(offerOrigins),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  postedOn: z.string().nullable(),
  url: z.string().nullable(),
  salary: z.string().nullable(),
  details: z.string().nullable(),
  description: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});
export type Offer = z.infer<typeof offerSchema>;

export const offersQuerySchema = z.object({
  source: sourceNameSchema.optional(),
  /** Cursor: the id of the last offer of the previous page. */
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const offersResponseSchema = z.object({
  offers: z.array(offerSchema),
  nextCursor: z.uuid().nullable(),
});
export type OffersResponse = z.infer<typeof offersResponseSchema>;

/** Only http and https links are kept: never javascript:, data: or the like (threat 6). */
export const offerUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .pipe(z.url({ protocol: /^https?$/, hostname: /^[^\s]+$/ }));

const optionalField = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value));

/**
 * An offer Mehdi adds himself: the link is stored, never opened by the server (threat 1). The
 * configuration caps the text further (collect.manual.maxTextChars).
 */
export const manualOfferInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: offerUrlSchema.nullable().default(null),
  company: optionalField(200),
  location: optionalField(200),
  text: optionalField(50_000),
});
export type ManualOfferInput = z.input<typeof manualOfferInputSchema>;
