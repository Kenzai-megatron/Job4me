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
