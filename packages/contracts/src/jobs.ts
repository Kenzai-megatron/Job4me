// Background jobs the API asks the worker to run (pg-boss queues).
export const QUEUES = {
  pushTest: 'push_test',
  maintenancePurge: 'maintenance_purge',
  keywordsPropose: 'keywords_propose',
  /** Every day: one pass per account, with the sources due that day (ADR 0013). */
  collectSchedule: 'collect_schedule',
  /** One collection pass (scheduled, manual or test), one source at a time. */
  collectPass: 'collect_pass',
  /** The deterministic filter again on every offer of an account, its criteria changed. */
  offersScreen: 'offers_screen',
  /** The scoring by Claude after a pass, when switched on (phase 3 plan, sections 7 bis and 8). */
  offersAiScore: 'offers_ai_score',
  /** The measure of the reference set (phase 3 plan, section 9). */
  scoringBenchmark: 'scoring_benchmark',
} as const;

/** Ask Claude Sonnet for search keywords (one run of keyword_proposal_run). */
export interface KeywordsProposeJob {
  userId: string;
  runId: string;
}

export interface PushTestJob {
  userId: string;
  requestId?: string;
}

/** Run one collection pass (one row of collection_pass). */
export interface CollectPassJob {
  userId: string;
  passId: string;
}

/** Run the deterministic filter again on every offer of an account (phase 3 plan, section 6). */
export interface OffersScreenJob {
  userId: string;
}

/** Score with Claude the kept offers of an account still without a current Claude score. */
export interface OffersAiScoreJob {
  userId: string;
}

/** Measure the scorings against the ratings (one row of scoring_benchmark). */
export interface ScoringBenchmarkJob {
  userId: string;
  benchmarkId: string;
}
