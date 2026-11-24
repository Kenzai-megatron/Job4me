import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { at, common, ownerPolicy } from './profile-schema';

// Phase 2 collection (plan, section 3; ADR 0013 to 0015). Every table belongs to one account
// (its keywords, radius and base city drive the collection) and is guarded twice, as in phase 1:
// the user_id filter of each query and row-level security (ADR 0011).

/** Per account and source: the switch, the wait after a 403 or 429, the last known quota. */
export const sourceSettings = pgTable(
  'source_setting',
  {
    ...common(),
    source: text('source').notNull(),
    /** Null until Mehdi touches the switch: the configuration's default then applies. */
    enabled: boolean('enabled'),
    /** No call at all before this time (LinkedIn: 24 hours after a 403 or 429). */
    cooldownUntil: at('cooldown_until'),
    quotaRemaining: integer('quota_remaining'),
    quotaCheckedAt: at('quota_checked_at'),
    /** Silent source (decision D4): nothing read without an error, or far less than usual. */
    alert: text('alert'),
    alertSince: at('alert_since'),
    /** What the run read, against the usual volume of the previous runs. */
    alertRead: integer('alert_read'),
    alertUsual: integer('alert_usual'),
    /** The phone was told once per incident, not at every pass. */
    alertNotifiedAt: at('alert_notified_at'),
  },
  (t) => [
    uniqueIndex('source_setting_user_source_idx').on(t.userId, t.source),
    check(
      'source_setting_alert_check',
      sql`${t.alert} is null or ${t.alert} in ('zero_read', 'collapse')`,
    ),
    check('source_setting_source_check', sql`${t.source} ~ '^[a-z][a-z0-9_]{1,31}$'`),
    ownerPolicy('source_setting'),
  ],
);

/** One pass: scheduled, manual or test, with the sources it plans to call. */
export const collectionPasses = pgTable(
  'collection_pass',
  {
    ...common(),
    trigger: text('trigger').notNull(),
    status: text('status').notNull().default('queued'),
    sources: text('sources')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    startedAt: at('started_at'),
    finishedAt: at('finished_at'),
  },
  (t) => [
    index('collection_pass_user_idx').on(t.userId, t.trigger, t.createdAt),
    check('collection_pass_trigger_check', sql`${t.trigger} in ('scheduled', 'manual', 'test')`),
    check(
      'collection_pass_status_check',
      sql`${t.status} in ('queued', 'running', 'done', 'interrupted')`,
    ),
    ownerPolicy('collection_pass'),
  ],
);

/**
 * One source in one pass (ADR 0013): read before any filter, kept after the title filter, then
 * among the kept ones the new announcements and the postings merged into one already there
 * (ADR 0016). Never a URL with a key, never page content: codes and counts only.
 */
export const sourceRuns = pgTable(
  'source_run',
  {
    ...common(),
    passId: uuid('pass_id')
      .notNull()
      .references(() => collectionPasses.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    trigger: text('trigger').notNull(),
    status: text('status').notNull().default('running'),
    skipReason: text('skip_reason'),
    errorCode: text('error_code'),
    httpStatus: integer('http_status'),
    readCount: integer('read_count').notNull().default(0),
    keptCount: integer('kept_count').notNull().default(0),
    newCount: integer('new_count').notNull().default(0),
    /** Postings of this run that joined an announcement already there (ADR 0016). */
    mergedCount: integer('merged_count').notNull().default(0),
    invalidCount: integer('invalid_count').notNull().default(0),
    requestCount: integer('request_count').notNull().default(0),
    durationMs: integer('duration_ms'),
    startedAt: at('started_at'),
    finishedAt: at('finished_at'),
  },
  (t) => [
    index('source_run_user_source_idx').on(t.userId, t.source, t.createdAt),
    index('source_run_pass_idx').on(t.passId),
    check('source_run_source_check', sql`${t.source} ~ '^[a-z][a-z0-9_]{1,31}$'`),
    check('source_run_trigger_check', sql`${t.trigger} in ('scheduled', 'manual', 'test')`),
    check(
      'source_run_status_check',
      sql`${t.status} in ('running', 'succeeded', 'partial', 'failed', 'skipped')`,
    ),
    check(
      'source_run_skip_reason_check',
      sql`${t.skipReason} is null or ${t.skipReason} in ('disabled', 'commercial_mode', 'cooldown', 'missing_key', 'no_keywords', 'quota', 'pass_budget')`,
    ),
    check(
      'source_run_skipped_check',
      sql`(${t.status} = 'skipped') = (${t.skipReason} is not null)`,
    ),
    check(
      'source_run_error_code_check',
      sql`${t.errorCode} is null or ${t.errorCode} in ('blocked', 'http_error', 'network_error', 'timeout', 'too_large', 'invalid_response', 'host_not_allowed', 'budget_exceeded', 'connector_error', 'interrupted')`,
    ),
    check(
      'source_run_counts_check',
      sql`${t.readCount} >= 0 and ${t.keptCount} >= 0 and ${t.newCount} >= 0 and ${t.mergedCount} >= 0 and ${t.invalidCount} >= 0 and ${t.requestCount} >= 0`,
    ),
    ownerPolicy('source_run'),
  ],
);

/**
 * Where a posting or an announcement is (ADR 0017): `found` with the locality's name and
 * coordinates, `unknown` (kept, shown without a distance) or `abroad`; null until the worker has
 * read the place (postings of phase 2). `remote` says what the offer announces: full or hybrid.
 */
const place = () => ({
  placeStatus: text('place_status'),
  placeName: text('place_name'),
  postalCode: text('postal_code'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  remote: text('remote'),
});

const placeChecks = (
  table: string,
  t: { placeStatus: AnyPgColumn; remote: AnyPgColumn; postalCode: AnyPgColumn },
) => [
  check(
    `${table}_place_status_check`,
    sql`${t.placeStatus} is null or ${t.placeStatus} in ('found', 'unknown', 'abroad')`,
  ),
  check(`${table}_remote_check`, sql`${t.remote} is null or ${t.remote} in ('full', 'hybrid')`),
  check(
    `${table}_postal_code_check`,
    sql`${t.postalCode} is null or ${t.postalCode} ~ '^[0-9]{4}$'`,
  ),
];

/**
 * The announcement (ADR 0016): one offer, however many sites carry it. Its postings are the
 * job_offer rows; it shows the retained one, which names the employer, then has the longest
 * description, then comes from the first source called. First and last sight are those of its
 * postings; it is deleted 90 days after the last one (ADR 0015), its postings with it. Its place
 * is the most precise of its postings', its distance the road distance from the profile's base
 * city (ADR 0017), recomputed when the base city changes.
 */
export const offers = pgTable(
  'offer',
  {
    ...common(),
    retainedId: uuid('retained_id').references((): AnyPgColumn => jobOffers.id, {
      onDelete: 'set null',
    }),
    firstSeenAt: at('first_seen_at').notNull().defaultNow(),
    lastSeenAt: at('last_seen_at').notNull().defaultNow(),
    ...place(),
    /** Kilometres by road from the base city; null when either place is unknown. */
    distanceKm: integer('distance_km'),
    /**
     * Why the deterministic filter sets it aside (phase 3 plan, section 6); null: kept. Read
     * again after each pass that touches it and after each change of the profile's criteria.
     */
    excludedReason: text('excluded_reason'),
    screenedAt: at('screened_at'),
    /** When a notification of new offers of 80 or more named it (decision D7): once only. */
    alertedAt: at('alerted_at'),
  },
  (t) => [
    index('offer_user_first_seen_idx').on(t.userId, t.firstSeenAt),
    index('offer_user_last_seen_idx').on(t.userId, t.lastSeenAt),
    check(
      'offer_excluded_reason_check',
      sql`${t.excludedReason} is null or ${t.excludedReason} in ('excluded_company', 'too_old', 'abroad', 'too_far', 'language', 'contract')`,
    ),
    ...placeChecks('offer', t),
    check('offer_distance_check', sql`${t.distanceKm} is null or ${t.distanceKm} >= 0`),
    ownerPolicy('offer'),
  ],
);

/**
 * A posting: an offer in the common format at one source (docs/SOURCES.md, section 1.1), one
 * row per source and identifier, attached to its announcement. Its identity (content key, bare
 * title, references) feeds the merge rules; `dedup_version` 0 marks a row of phase 2 that the
 * worker has yet to identify.
 */
export const jobOffers = pgTable(
  'job_offer',
  {
    ...common(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    origin: text('origin').notNull().default('collected'),
    title: text('title').notNull(),
    company: text('company').notNull().default('?'),
    location: text('location').notNull().default('?'),
    postedOn: date('posted_on'),
    /** Stored as given; the server never opens it (plan, section 9, threat 1). */
    url: text('url'),
    salary: text('salary'),
    description: text('description').notNull().default(''),
    details: text('details'),
    firstSeenAt: at('first_seen_at').notNull().defaultNow(),
    lastSeenAt: at('last_seen_at').notNull().defaultNow(),
    contentKey: text('content_key'),
    bareTitle: text('bare_title'),
    titleRefs: text('title_refs')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dedupVersion: integer('dedup_version').notNull().default(0),
    /** How it joined its announcement; null for the posting that started it. */
    mergeReason: text('merge_reason'),
    ...place(),
    /** Contracts and required languages given by the source in fields of their own. */
    contracts: text('contracts')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    languages: text('languages')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    uniqueIndex('job_offer_user_source_external_idx').on(t.userId, t.source, t.externalId),
    index('job_offer_user_first_seen_idx').on(t.userId, t.firstSeenAt),
    index('job_offer_user_last_seen_idx').on(t.userId, t.lastSeenAt),
    index('job_offer_offer_idx').on(t.offerId),
    index('job_offer_user_key_idx').on(t.userId, t.contentKey),
    index('job_offer_user_bare_idx').on(t.userId, t.bareTitle),
    index('job_offer_user_version_idx').on(t.userId, t.dedupVersion),
    check('job_offer_source_check', sql`${t.source} ~ '^[a-z][a-z0-9_]{1,31}$'`),
    ...placeChecks('job_offer', t),
    check(
      'job_offer_merge_reason_check',
      sql`${t.mergeReason} is null or ${t.mergeReason} in ('key', 'reference', 'url', 'employer', 'no_employer')`,
    ),
    check('job_offer_origin_check', sql`${t.origin} in ('collected', 'manual')`),
    check('job_offer_url_check', sql`${t.url} is null or ${t.url} ~* '^https?://'`),
    check(
      'job_offer_length_check',
      sql`char_length(${t.title}) between 1 and 300 and char_length(${t.description}) <= 50000`,
    ),
    ownerPolicy('job_offer'),
  ],
);

/**
 * The current score of an announcement (phase 3 plan, section 3; ADR 0018): without AI by default
 * (`rules`, its factors), or by Claude once switched on (`claude_quick`, then `claude_detailed`
 * from 70). Computed again only when the profile or the offer changes (their versions), or when
 * the rules change; a Claude score no longer current gives way to the score without AI.
 */
export const offerScores = pgTable(
  'offer_score',
  {
    ...common(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    score: integer('score').notNull(),
    confidence: text('confidence').notNull(),
    /** What made a score without AI, as data the interface words. */
    factors: jsonb('factors').$type<unknown[]>(),
    /** Claude's reason, in one sentence. */
    reason: text('reason'),
    /**
     * The detailed analysis by Claude Sonnet (phase 3 plan, section 8): subscores of the grid and
     * the weights used, strengths, gaps, blocking elements, keywords.
     */
    analysis: jsonb('analysis').$type<Record<string, unknown>>(),
    model: text('model'),
    promptVersion: text('prompt_version'),
    profileVersion: text('profile_version').notNull(),
    offerVersion: text('offer_version').notNull(),
    scoredAt: at('scored_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('offer_score_offer_idx').on(t.offerId),
    index('offer_score_user_idx').on(t.userId, t.score),
    check(
      'offer_score_method_check',
      sql`${t.method} in ('rules', 'claude_quick', 'claude_detailed')`,
    ),
    check('offer_score_confidence_check', sql`${t.confidence} in ('low', 'normal')`),
    check('offer_score_score_check', sql`${t.score} between 0 and 100`),
    ownerPolicy('offer_score'),
  ],
);

/**
 * Mehdi's own rating of an announcement (phase 3 plan, section 9): the reference set that
 * measures the scorings, and a few of them the calibration of Claude's severity. Never in the
 * repository or the CI (decision D1); a rated announcement is never purged.
 */
export const offerRatings = pgTable(
  'offer_rating',
  {
    ...common(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('offer_rating_offer_idx').on(t.offerId),
    index('offer_rating_user_idx').on(t.userId, t.createdAt),
    check('offer_rating_rating_check', sql`${t.rating} between 0 and 100`),
    check('offer_rating_note_check', sql`${t.note} is null or char_length(${t.note}) <= 200`),
    ownerPolicy('offer_rating'),
  ],
);

/**
 * One measure of the reference set (phase 3 plan, section 9): the scoring without AI, and Claude
 * when asked, against Mehdi's ratings; and the share of his offers of 60 or more that the title
 * filter would have set aside. Run by the worker, asked for from the home machine.
 */
export const scoringBenchmarks = pgTable(
  'scoring_benchmark',
  {
    ...common(),
    status: text('status').notNull().default('queued'),
    /** Claude asked for too (it costs a few cents), else the scoring without AI only. */
    withClaude: boolean('with_claude').notNull().default(false),
    errorCode: text('error_code'),
    rated: integer('rated').notNull().default(0),
    rulesVersion: text('rules_version'),
    rulesMeanGap: doublePrecision('rules_mean_gap'),
    /** The five widest gaps: offer, title, rating, score. */
    rulesWorst: jsonb('rules_worst').$type<unknown[]>(),
    /** Claude is measured on the rated offers that are not its calibration. */
    claudeRated: integer('claude_rated'),
    claudeMeanGap: doublePrecision('claude_mean_gap'),
    claudeWorst: jsonb('claude_worst').$type<unknown[]>(),
    quickModel: text('quick_model'),
    detailedModel: text('detailed_model'),
    promptVersion: text('prompt_version'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }).notNull().default(0),
    /** Offers rated 60 or more, and how many of them the title filter would set aside. */
    filterRated: integer('filter_rated'),
    filterRejected: integer('filter_rejected'),
    finishedAt: at('finished_at'),
  },
  (t) => [
    index('scoring_benchmark_user_idx').on(t.userId, t.createdAt),
    check(
      'scoring_benchmark_status_check',
      sql`${t.status} in ('queued', 'running', 'done', 'failed')`,
    ),
    check(
      'scoring_benchmark_error_code_check',
      sql`${t.errorCode} is null or ${t.errorCode} in ('ai_disabled', 'ai_cap_reached', 'ai_refused', 'ai_invalid_output', 'ai_failed', 'no_rating')`,
    ),
    check('scoring_benchmark_cost_check', sql`${t.costUsd} >= 0`),
    ownerPolicy('scoring_benchmark'),
  ],
);

export type SourceSettingRow = typeof sourceSettings.$inferSelect;
export type CollectionPassRow = typeof collectionPasses.$inferSelect;
export type SourceRunRow = typeof sourceRuns.$inferSelect;
export type JobOfferRow = typeof jobOffers.$inferSelect;
export type OfferRow = typeof offers.$inferSelect;
export type OfferScoreRow = typeof offerScores.$inferSelect;
export type OfferRatingRow = typeof offerRatings.$inferSelect;
export type ScoringBenchmarkRow = typeof scoringBenchmarks.$inferSelect;
