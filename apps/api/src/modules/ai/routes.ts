import {
  type AiCallStatus,
  type AiUsage,
  aiUsageResponseSchema,
  aiUsages,
  benchmarksResponseSchema,
  type KeywordRun,
  keywordRunSchema,
  latestKeywordRunSchema,
  QUEUES,
} from '@job4me/contracts';
import { and, count, desc, eq, gte, recordAudit, schema, sql, withUser } from '@job4me/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../context';
import { HttpError } from '../../errors';
import { requireSession } from '../auth/guards';
import { toBenchmark } from './benchmarks';

// AI from the API side (plan, section 8): the API never calls Claude. It queues the keyword
// proposal for the worker, and shows what the calls cost, never what they said.

/** The weekly cap is over a rolling week. */
const WEEK_MS = 7 * 86_400_000;

type RunRow = typeof schema.keywordProposalRuns.$inferSelect;

function toRun(row: RunRow): KeywordRun {
  return keywordRunSchema.parse({
    id: row.id,
    status: row.status,
    errorCode: row.errorCode,
    proposed: row.proposed,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function aiRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  const { settings } = deps.config;
  const runs = schema.keywordProposalRuns;

  return async (app) => {
    app.post(
      '/api/profile/keywords/propose',
      {
        config: {
          rateLimit: { max: settings.ai.keywords.requestsPerHour, timeWindow: '1 hour' },
        },
        schema: { response: { 200: keywordRunSchema } },
      },
      async (request) => {
        const { userId } = requireSession(request);
        if (!deps.queue) throw new HttpError(503, 'internal_error');
        const queue = deps.queue;
        const run = await withUser(deps.db, userId, async (tx) => {
          const [jobs] = await tx
            .select({ n: count() })
            .from(schema.targetJobs)
            .where(eq(schema.targetJobs.userId, userId));
          if ((jobs?.n ?? 0) === 0) throw new HttpError(400, 'keywords_need_target_job');
          // One request at a time: a pending one is returned instead of a second call.
          const [pending] = await tx
            .select()
            .from(runs)
            .where(
              and(
                eq(runs.userId, userId),
                sql`${runs.status} in ('queued', 'running')`,
                gte(runs.createdAt, new Date(Date.now() - settings.ai.keywords.staleAfterMs)),
              ),
            )
            .orderBy(desc(runs.createdAt))
            .limit(1);
          if (pending) return { row: pending, created: false };
          const [created] = await tx.insert(runs).values({ userId }).returning();
          await recordAudit(tx, {
            actorType: 'user',
            actorUserId: userId,
            action: 'ai.keywords_requested',
            outcome: 'success',
            requestId: request.id,
            metadata: {},
          });
          return { row: created!, created: true };
        });
        if (run.created) {
          await queue.send(QUEUES.keywordsPropose, { userId, runId: run.row.id });
        }
        return toRun(run.row);
      },
    );

    app.get(
      '/api/profile/keywords/propose',
      { schema: { response: { 200: latestKeywordRunSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const [row] = await withUser(deps.db, userId, (tx) =>
          tx
            .select()
            .from(runs)
            .where(eq(runs.userId, userId))
            .orderBy(desc(runs.createdAt))
            .limit(1),
        );
        return { run: row ? toRun(row) : null };
      },
    );

    app.get(
      '/api/ai/usage',
      { schema: { response: { 200: aiUsageResponseSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const calls = schema.aiCalls;
        const since = new Date(Date.now() - WEEK_MS);
        return withUser(deps.db, userId, async (tx) => {
          const [sums] = await tx
            .select({
              week: sql<number>`coalesce(sum(${calls.costUsd}) filter (where ${calls.createdAt} >= ${since}), 0)::float8`,
              total: sql<number>`coalesce(sum(${calls.costUsd}), 0)::float8`,
            })
            .from(calls)
            .where(eq(calls.userId, userId));
          const perUsage = await tx
            .select({
              usage: calls.usage,
              week: sql<number>`coalesce(sum(${calls.costUsd}) filter (where ${calls.createdAt} >= ${since}), 0)::float8`,
              total: sql<number>`coalesce(sum(${calls.costUsd}), 0)::float8`,
              // Requests sent: the ones a cap or a missing key held back cost nothing.
              calls: sql<number>`(count(*) filter (where ${calls.status} not in ('blocked', 'disabled')))::int`,
            })
            .from(calls)
            .where(eq(calls.userId, userId))
            .groupBy(calls.usage);
          const recent = await tx
            .select()
            .from(calls)
            .where(eq(calls.userId, userId))
            .orderBy(desc(calls.createdAt))
            .limit(20);
          const spend = new Map(perUsage.map((row) => [row.usage, row]));
          return {
            weekUsd: sums?.week ?? 0,
            totalUsd: sums?.total ?? 0,
            caps: settings.ai.caps,
            byUsage: aiUsages.flatMap((usage) => {
              const row = spend.get(usage);
              return row
                ? [{ usage, weekUsd: row.week, totalUsd: row.total, calls: row.calls }]
                : [];
            }),
            calls: recent.map((call) => ({
              id: call.id,
              usage: call.usage as AiUsage,
              model: call.model,
              status: call.status as AiCallStatus,
              inputTokens: call.inputTokens + call.cacheReadTokens + call.cacheWriteTokens,
              outputTokens: call.outputTokens,
              cacheReadTokens: call.cacheReadTokens,
              costUsd: call.costUsd,
              createdAt: call.createdAt.toISOString(),
            })),
          };
        });
      },
    );

    // The reference set (phase 3 plan, section 9): how many offers Mehdi rated, and the last
    // measures of the scorings against his ratings (asked for from the home machine).
    app.get(
      '/api/scoring/benchmarks',
      { schema: { response: { 200: benchmarksResponseSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const { reference } = settings.scoring;
        return withUser(deps.db, userId, async (tx) => {
          const [rated] = await tx
            .select({ n: count() })
            .from(schema.offerRatings)
            .where(eq(schema.offerRatings.userId, userId));
          const rows = await tx
            .select()
            .from(schema.scoringBenchmarks)
            .where(eq(schema.scoringBenchmarks.userId, userId))
            .orderBy(desc(schema.scoringBenchmarks.createdAt))
            .limit(10);
          return {
            rated: rated?.n ?? 0,
            goal: reference.goal,
            maxMeanGap: reference.maxMeanGap,
            filterRating: reference.filterRating,
            benchmarks: rows.map(toBenchmark),
          };
        });
      },
    );
  };
}
