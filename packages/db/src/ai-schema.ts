import { and, eq, inArray, sql } from 'drizzle-orm';
import { check, index, integer, numeric, pgTable, pgView, text, uuid } from 'drizzle-orm/pg-core';
import { importRuns, uploads } from './import-schema';
import { at, bytea, common, ownerPolicy } from './profile-schema';

// Claude API (plan, sections 3 and 5; ADR 0009): the log of every call, the proposals drawn from
// an import, and the keyword proposal runs. Row-level security as for the profile (ADR 0011).

/** One request to the Claude API, or one that was not sent (cap, no key). Never its content. */
export const aiCalls = pgTable(
  'ai_call',
  {
    ...common(),
    usage: text('usage').notNull(),
    /** The model that answered (after a fallback, not the one asked for). */
    model: text('model').notNull(),
    status: text('status').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }).notNull().default(0),
    /** Anthropic's request identifier, for support. */
    requestId: text('request_id'),
    durationMs: integer('duration_ms'),
  },
  (t) => [
    index('ai_call_user_id_idx').on(t.userId, t.createdAt),
    check('ai_call_usage_check', sql`${t.usage} in ('cv_structuring', 'keywords')`),
    check(
      'ai_call_status_check',
      sql`${t.status} in ('succeeded', 'refused', 'invalid_output', 'failed', 'blocked', 'disabled')`,
    ),
    check('ai_call_cost_check', sql`${t.costUsd} >= 0`),
    ownerPolicy('ai_call'),
  ],
);

/** A proposed profile entry drawn from an import, waiting for Mehdi's decision (lot 5). */
export const importProposals = pgTable(
  'import_proposal',
  {
    ...common(),
    importRunId: uuid('import_run_id')
      .notNull()
      .references(() => importRuns.id, { onDelete: 'cascade' }),
    rubric: text('rubric').notNull(),
    /** local: found without the AI (identity); ai: Claude Haiku; linkedin: archive columns. */
    source: text('source').notNull(),
    /** The entry and its evidence: AES-256-GCM under the import key, bound to this row. */
    content: bytea('content').notNull(),
    decision: text('decision').notNull().default('pending'),
    decidedAt: at('decided_at'),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    index('import_proposal_run_idx').on(t.importRunId, t.position),
    check(
      'import_proposal_rubric_check',
      sql`${t.rubric} in ('identity', 'target-jobs', 'experiences', 'facts', 'education', 'certifications', 'skills', 'languages')`,
    ),
    check('import_proposal_source_check', sql`${t.source} in ('local', 'ai', 'linkedin')`),
    check(
      'import_proposal_decision_check',
      sql`${t.decision} in ('pending', 'accepted', 'corrected', 'ignored')`,
    ),
    ownerPolicy('import_proposal'),
  ],
);

/** A request for search keywords from Claude Sonnet, run by the worker. */
export const keywordProposalRuns = pgTable(
  'keyword_proposal_run',
  {
    ...common(),
    status: text('status').notNull().default('queued'),
    errorCode: text('error_code'),
    proposed: integer('proposed').notNull().default(0),
  },
  (t) => [
    index('keyword_proposal_run_user_id_idx').on(t.userId, t.createdAt),
    check(
      'keyword_proposal_run_status_check',
      sql`${t.status} in ('queued', 'running', 'done', 'failed')`,
    ),
    check(
      'keyword_proposal_run_error_code_check',
      sql`${t.errorCode} is null or ${t.errorCode} in ('ai_disabled', 'ai_cap_reached', 'ai_refused', 'ai_invalid_output', 'ai_failed')`,
    ),
    ownerPolicy('keyword_proposal_run'),
  ],
);

/**
 * CV imports ready for structuring, across accounts: identifiers and steps only, no content.
 * Owned by the migration role, so the worker finds them before it knows the account; it then
 * reads each one under row-level security for that account.
 */
export const importRunsReady = pgView('import_run_ready').as((qb) =>
  qb
    .select({
      id: importRuns.id,
      userId: importRuns.userId,
      status: importRuns.status,
      updatedAt: importRuns.updatedAt,
    })
    .from(importRuns)
    .innerJoin(uploads, eq(uploads.id, importRuns.uploadId))
    .where(
      and(
        inArray(importRuns.status, ['extracted', 'structuring']),
        inArray(uploads.kind, ['cv_pdf', 'cv_docx']),
      ),
    ),
);

export type AiCall = typeof aiCalls.$inferSelect;
export type ImportProposal = typeof importProposals.$inferSelect;
export type KeywordProposalRun = typeof keywordProposalRuns.$inferSelect;
