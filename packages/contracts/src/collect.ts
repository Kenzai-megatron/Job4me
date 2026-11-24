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

/**
 * One source in one pass: read before any filter, kept after the title filter; among the kept
 * ones, the new announcements and the postings merged into an announcement already there.
 */
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
  mergedCount: z.number().int().min(0),
  invalidCount: z.number().int().min(0),
  requestCount: z.number().int().min(0),
  durationMs: z.number().int().min(0).nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type SourceRun = z.infer<typeof sourceRunSchema>;

/** Silent source (decision D4): nothing read without an error, or far less than usual. */
export const sourceAlertKinds = ['zero_read', 'collapse'] as const;
export type SourceAlertKind = (typeof sourceAlertKinds)[number];

export const sourceAlertSchema = z.object({
  kind: z.enum(sourceAlertKinds),
  since: z.string(),
  /** Read by the run that raised it, against the usual volume of the previous runs. */
  read: z.number().int().min(0).nullable(),
  usual: z.number().int().min(0).nullable(),
});
export type SourceAlert = z.infer<typeof sourceAlertSchema>;

/** Scheduled and manual runs over the window of the configuration (four weeks), tests apart. */
export const sourceWindowSchema = z.object({
  days: z.number().int().min(1),
  runs: z.number().int().min(0),
  failed: z.number().int().min(0),
  read: z.number().int().min(0),
  kept: z.number().int().min(0),
  fresh: z.number().int().min(0),
  merged: z.number().int().min(0),
});
export type SourceWindow = z.infer<typeof sourceWindowSchema>;

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
  alert: sourceAlertSchema.nullable(),
  /** Searches left on a rationed source (SerpApi), as its account said at the last pass. */
  quota: z.object({ remaining: z.number().int(), checkedAt: z.string() }).nullable(),
  window: sourceWindowSchema,
  /**
   * Relevance over the window (SPEC, section 9): of the kept announcements this source carries,
   * how many are scored, and how many 80 or more.
   */
  relevance: z.object({ scored: z.number().int().min(0), top: z.number().int().min(0) }),
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

/**
 * Why a posting joined an announcement (ADR 0016), strongest first: the same content key, a
 * common internal reference, the same link, the same employer up to a name extension, or one of
 * the two without an employer (the last three at an identical bare title).
 */
export const mergeReasons = ['key', 'reference', 'url', 'employer', 'no_employer'] as const;
export type MergeReason = (typeof mergeReasons)[number];

/**
 * Where an offer is (ADR 0017): found in the Belgian localities, unknown (kept, without a
 * distance) or abroad; null until the worker has read it.
 */
export const placeStatuses = ['found', 'unknown', 'abroad'] as const;
export type PlaceStatus = (typeof placeStatuses)[number];
/** Remote work announced by an offer: fully, or partly. */
export const remoteModes = ['full', 'hybrid'] as const;
export type RemoteMode = (typeof remoteModes)[number];

export const postingPlaceSchema = z.object({
  status: z.enum(placeStatuses).nullable(),
  name: z.string().nullable(),
  postalCode: z.string().nullable(),
});

/**
 * Why the deterministic filter sets an offer aside (phase 3 plan, section 6), first applicable:
 * an employer excluded in the profile, an ad older than the limit, a place abroad or beyond the
 * radius (unless remote work is announced and accepted), a language or a contract that the
 * source gives as a field and the profile rules out. Never applied to an offer added by hand.
 */
export const exclusionReasons = [
  'excluded_company',
  'too_old',
  'abroad',
  'too_far',
  'language',
  'contract',
] as const;
export type ExclusionReason = (typeof exclusionReasons)[number];

/** How a score was made: without AI (the default), or by Claude once switched on (ADR 0018). */
export const scoreMethods = ['rules', 'claude_quick', 'claude_detailed'] as const;
export type ScoreMethod = (typeof scoreMethods)[number];
/** The bands of the specification: 80 apply today, 60 relevant, 40 for want of better, 0 off. */
export const scoreBands = ['80', '60', '40', '0'] as const;
export type ScoreBandName = (typeof scoreBands)[number];

const contractKinds = [
  'permanent',
  'fixed_term',
  'interim',
  'freelance',
  'internship',
  'student_job',
] as const;

/** What made a score without AI, as data the interface words (packages/collect, score). */
export const scoreFactorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('title'),
    strength: z.enum(['target', 'priority', 'keyword', 'partial', 'none']),
    match: z.string().nullable(),
  }),
  z.object({ kind: z.literal('skills'), matched: z.array(z.string()) }),
  z.object({ kind: z.literal('language'), code: z.string(), level: z.string().nullable() }),
  z.object({
    kind: z.literal('distance'),
    status: z.enum(placeStatuses).nullable(),
    km: z.number().int().nullable(),
    remote: z.enum(remoteModes).nullable(),
  }),
  z.object({
    kind: z.literal('contract'),
    contracts: z.array(z.enum(contractKinds)),
    wanted: z.boolean().nullable(),
  }),
  z.object({
    kind: z.literal('regime'),
    regime: z.enum(['full_time', 'part_time']),
    wanted: z.boolean(),
  }),
  z.object({ kind: z.literal('freshness'), days: z.number().int().min(0) }),
  z.object({ kind: z.literal('sector'), sector: z.string() }),
  z.object({ kind: z.literal('rejected'), expression: z.string() }),
]);
export type ScoreFactor = z.infer<typeof scoreFactorSchema>;

const gridShape = <T extends z.ZodType>(value: T) =>
  z.object({
    skills: value,
    experience: value,
    languages: value,
    practical: value,
    sector: value,
    motivations: value,
  });

/**
 * The detailed analysis of an offer (phase 3 plan, section 8): the grid's subscores and the
 * weights they were combined with, strengths, gaps, blocking elements, keywords to reuse.
 */
export const scoreAnalysisSchema = z.object({
  subscores: gridShape(z.number().int().min(0).max(100)),
  weights: gridShape(z.number().int().min(0).max(100)),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  blockers: z.array(z.string()),
  keywords: z.array(z.string()),
});
export type ScoreAnalysis = z.infer<typeof scoreAnalysisSchema>;

/** The current score of an announcement: always explained, at low confidence without AI. */
export const offerScoreSchema = z.object({
  value: z.number().int().min(0).max(100),
  method: z.enum(scoreMethods),
  confidence: z.enum(['low', 'normal']),
  factors: z.array(scoreFactorSchema),
  /** Claude's reason, in one sentence. */
  reason: z.string().nullable(),
  /** The detailed analysis, when Claude Sonnet made one. */
  analysis: scoreAnalysisSchema.nullable(),
  scoredAt: z.string(),
});
export type OfferScore = z.infer<typeof offerScoreSchema>;

/** Mehdi's own rating of an offer (phase 3 plan, section 9): the reference set. */
export const offerRatingSchema = z.object({
  value: z.number().int().min(0).max(100),
  note: z.string().nullable(),
  ratedAt: z.string(),
});
export type OfferRating = z.infer<typeof offerRatingSchema>;
export const offerRatingInputSchema = z.object({
  value: z.number().int().min(0).max(100),
  note: z.string().trim().max(200).nullable().default(null),
});
export type OfferRatingInput = z.input<typeof offerRatingInputSchema>;

/** A posting: the offer as one site carries it (docs/SOURCES.md, section 1.1); "?" is unknown. */
export const offerPostingSchema = z.object({
  id: z.uuid(),
  source: sourceNameSchema,
  origin: z.enum(offerOrigins),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  postedOn: z.string().nullable(),
  url: z.string().nullable(),
  /** How it joined the announcement; null for the posting that started it. */
  mergeReason: z.enum(mergeReasons).nullable(),
  place: postingPlaceSchema,
  remote: z.enum(remoteModes).nullable(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});
export type OfferPosting = z.infer<typeof offerPostingSchema>;

/**
 * An announcement (ADR 0016): one offer, however many sites carry it. It shows its retained
 * posting (it names the employer, then has the longest description); `postings` lists every
 * site, the retained posting first.
 */
export const offerSchema = z.object({
  id: z.uuid(),
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
  /** The most precise place of its postings, and the road distance from the base city. */
  place: postingPlaceSchema.extend({ distanceKm: z.number().int().min(0).nullable() }),
  remote: z.enum(remoteModes).nullable(),
  /** Why the deterministic filter sets it aside; null: kept. */
  excluded: z.enum(exclusionReasons).nullable(),
  /** Its score, once computed (only the kept offers are scored). */
  score: offerScoreSchema.nullable(),
  /** Mehdi's own rating, when he gave one. */
  rating: offerRatingSchema.nullable(),
  postings: z.array(offerPostingSchema).min(1),
});
export type Offer = z.infer<typeof offerSchema>;

/** The offers kept by the deterministic filter, or the ones it sets aside (« why not shown »). */
export const offerViews = ['kept', 'excluded'] as const;
export type OfferView = (typeof offerViews)[number];

export const offersQuerySchema = z.object({
  view: z.enum(offerViews).default('kept'),
  /** Announcements carried by this source among others. */
  source: sourceNameSchema.optional(),
  /** Announcements of one band of scores. */
  band: z.enum(scoreBands).optional(),
  /** Announcements first seen within the last seven days. */
  fresh: z.stringbool().optional(),
  /** Cursor: the id of the last offer of the previous page. */
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const offerParamsSchema = z.object({ id: z.uuid() });

/** "Not the same offer": the posting leaves the announcement and starts its own. */
export const offerUnmergeSchema = z.object({ postingId: z.uuid() });
export const offerUnmergeResponseSchema = z.object({ offer: offerSchema, detached: offerSchema });
export type OfferUnmergeResponse = z.infer<typeof offerUnmergeResponseSchema>;
export const offersResponseSchema = z.object({
  offers: z.array(offerSchema),
  nextCursor: z.uuid().nullable(),
  /** How many offers each view holds, the source filter applied. */
  counts: z.object({ kept: z.number().int().min(0), excluded: z.number().int().min(0) }),
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

/** The announcement the offer added by hand belongs to: `merged` when it was already there. */
export const manualOfferResponseSchema = z.object({ offer: offerSchema, merged: z.boolean() });
export type ManualOfferResponse = z.infer<typeof manualOfferResponseSchema>;

/** Why a measure of the reference set gave nothing; the interface translates them. */
export const benchmarkErrorCodes = [
  'ai_disabled',
  'ai_cap_reached',
  'ai_refused',
  'ai_invalid_output',
  'ai_failed',
  'no_rating',
] as const;
export type BenchmarkErrorCode = (typeof benchmarkErrorCodes)[number];
export const benchmarkStatuses = ['queued', 'running', 'done', 'failed'] as const;

/** One of the widest gaps between a rating and a score. */
export const benchmarkGapSchema = z.object({
  offerId: z.uuid(),
  title: z.string(),
  rating: z.number().int().min(0).max(100),
  score: z.number().int().min(0).max(100),
});
export type BenchmarkGap = z.infer<typeof benchmarkGapSchema>;

/** One measure of the reference set (phase 3 plan, section 9). */
export const benchmarkSchema = z.object({
  id: z.uuid(),
  status: z.enum(benchmarkStatuses),
  errorCode: z.enum(benchmarkErrorCodes).nullable(),
  withClaude: z.boolean(),
  rated: z.number().int().min(0),
  rules: z
    .object({ version: z.string(), meanGap: z.number().min(0), worst: z.array(benchmarkGapSchema) })
    .nullable(),
  claude: z
    .object({
      rated: z.number().int().min(0),
      meanGap: z.number().min(0),
      worst: z.array(benchmarkGapSchema),
      quickModel: z.string(),
      detailedModel: z.string(),
      promptVersion: z.string(),
      costUsd: z.number().min(0),
      /** Per offer measured. */
      costPerOfferUsd: z.number().min(0),
    })
    .nullable(),
  /** Offers rated 60 or more that the title filter would have set aside. */
  titleFilter: z
    .object({ rated: z.number().int().min(0), rejected: z.number().int().min(0) })
    .nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Benchmark = z.infer<typeof benchmarkSchema>;

export const benchmarksResponseSchema = z.object({
  /** Offers Mehdi rated, and how many the reference set calls for. */
  rated: z.number().int().min(0),
  goal: z.number().int().min(1),
  /** The gap the specification accepts (Hypothèse: 10 points). */
  maxMeanGap: z.number().min(0),
  /** The title filter is measured on the offers rated this much or more (SPEC: 60). */
  filterRating: z.number().int().min(0).max(100),
  benchmarks: z.array(benchmarkSchema),
});
export type BenchmarksResponse = z.infer<typeof benchmarksResponseSchema>;
