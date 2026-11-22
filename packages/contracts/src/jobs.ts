// Background jobs the API asks the worker to run (pg-boss queues).
export const QUEUES = {
  pushTest: 'push_test',
  maintenancePurge: 'maintenance_purge',
  keywordsPropose: 'keywords_propose',
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
