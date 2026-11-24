import { availableConnectors, lockedByUsageMode, sourceSettings } from '@job4me/collect';
import {
  latestTestResponseSchema,
  passSchema,
  sourceParamsSchema,
  sourceRunsQuerySchema,
  sourceRunsResponseSchema,
  type SourceSummary,
  sourceSummarySchema,
  sourcesResponseSchema,
  sourceTestRequestSchema,
  sourceToggleSchema,
} from '@job4me/contracts';
import {
  and,
  desc,
  eq,
  gte,
  isNull,
  ne,
  recordAudit,
  schema,
  sql,
  type Transaction,
  withUser,
} from '@job4me/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../context';
import { HttpError } from '../../errors';
import { requireSession } from '../auth/guards';
import { createPass, loadPass, plannedSources, queuePass, toSourceRun } from './passes';

// Sources (phase 2 plan, section 8); offers are in ./offers. Every query filters on the
// signed-in account and runs under row-level security for it (ADR 0011).

export function collectRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  const { settings } = deps.config;
  const now = () => deps.now?.() ?? new Date();
  const connectors = () => deps.connectors ?? availableConnectors(settings);
  const findConnector = (name: string) => connectors().find((item) => item.name === name);

  /** What the Sources screen shows of each source, or of the ones named. */
  async function summaries(
    tx: Transaction,
    userId: string,
    only?: string,
  ): Promise<SourceSummary[]> {
    const rows = await tx
      .select()
      .from(schema.sourceSettings)
      .where(eq(schema.sourceSettings.userId, userId));
    const byName = new Map(rows.map((row) => [row.source, row]));
    // The figures of the window (four weeks): scheduled and manual runs only, tests apart.
    const days = settings.collect.runs.windowDays;
    const runs = schema.sourceRuns;
    const figures = await tx
      .select({
        source: runs.source,
        runs: sql<number>`count(*) filter (where ${runs.status} <> 'skipped')::int`,
        failed: sql<number>`count(*) filter (where ${runs.status} = 'failed')::int`,
        read: sql<number>`coalesce(sum(${runs.readCount}), 0)::int`,
        kept: sql<number>`coalesce(sum(${runs.keptCount}), 0)::int`,
        fresh: sql<number>`coalesce(sum(${runs.newCount}), 0)::int`,
        merged: sql<number>`coalesce(sum(${runs.mergedCount}), 0)::int`,
      })
      .from(runs)
      .where(
        and(
          eq(runs.userId, userId),
          ne(runs.trigger, 'test'),
          gte(runs.createdAt, new Date(now().getTime() - days * 86_400_000)),
        ),
      )
      .groupBy(runs.source);
    const windows = new Map(figures.map(({ source, ...counts }) => [source, counts]));
    // Relevance (SPEC, section 9): the kept announcements a source carried over the window, how
    // many are scored, and how many 80 or more.
    const postings = schema.jobOffers;
    const offers = schema.offers;
    const scores = schema.offerScores;
    const relevance = await tx
      .select({
        source: postings.source,
        scored: sql<number>`count(distinct ${offers.id}) filter (where ${scores.score} is not null)::int`,
        top: sql<number>`count(distinct ${offers.id}) filter (where ${scores.score} >= 80)::int`,
      })
      .from(postings)
      .innerJoin(offers, eq(offers.id, postings.offerId))
      .leftJoin(scores, eq(scores.offerId, offers.id))
      .where(
        and(
          eq(postings.userId, userId),
          isNull(offers.excludedReason),
          gte(postings.firstSeenAt, new Date(now().getTime() - days * 86_400_000)),
        ),
      )
      .groupBy(postings.source);
    const relevant = new Map(relevance.map(({ source, ...counts }) => [source, counts]));
    const result: SourceSummary[] = [];
    for (const connector of connectors()) {
      if (only && connector.name !== only) continue;
      const config = sourceSettings(settings, connector.name);
      const row = byName.get(connector.name);
      const locked = lockedByUsageMode(connector, settings);
      const latest = await tx
        .select()
        .from(runs)
        .where(and(eq(runs.userId, userId), eq(runs.source, connector.name)))
        .orderBy(desc(runs.createdAt))
        .limit(settings.collect.runs.perSource);
      result.push(
        sourceSummarySchema.parse({
          name: connector.name,
          access: connector.access,
          family: connector.family,
          keywordLevel: connector.keywordLevel,
          personalUseOnly: connector.personalUseOnly,
          weekdays: config.weekdays,
          enabled: !locked && (row?.enabled ?? config.enabledByDefault),
          locked,
          cooldownUntil:
            row?.cooldownUntil && row.cooldownUntil > now()
              ? row.cooldownUntil.toISOString()
              : null,
          alert:
            row?.alert && row.alertSince
              ? {
                  kind: row.alert,
                  since: row.alertSince.toISOString(),
                  read: row.alertRead,
                  usual: row.alertUsual,
                }
              : null,
          quota:
            row?.quotaRemaining !== null && row?.quotaRemaining !== undefined && row.quotaCheckedAt
              ? { remaining: row.quotaRemaining, checkedAt: row.quotaCheckedAt.toISOString() }
              : null,
          window: {
            days,
            ...(windows.get(connector.name) ?? {
              runs: 0,
              failed: 0,
              read: 0,
              kept: 0,
              fresh: 0,
              merged: 0,
            }),
          },
          relevance: relevant.get(connector.name) ?? { scored: 0, top: 0 },
          runs: latest.map(toSourceRun),
        }),
      );
    }
    return result;
  }

  return async (app) => {
    app.get(
      '/api/sources',
      { schema: { response: { 200: sourcesResponseSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const sources = await withUser(deps.db, userId, (tx) => summaries(tx, userId));
        return { usageMode: settings.collect.usageMode, sources };
      },
    );

    app.patch(
      '/api/sources/:name',
      {
        schema: {
          params: sourceParamsSchema,
          body: sourceToggleSchema,
          response: { 200: sourceSummarySchema },
        },
      },
      async (request) => {
        const { userId } = requireSession(request);
        const { name } = request.params;
        const connector = findConnector(name);
        if (!connector) throw new HttpError(404, 'source_unknown');
        // Commercial mode: LinkedIn guest and public pages cannot be switched on (ADR 0014).
        if (request.body.enabled && lockedByUsageMode(connector, settings)) {
          throw new HttpError(409, 'source_commercial_mode');
        }
        return withUser(deps.db, userId, async (tx) => {
          const at = now();
          await tx
            .insert(schema.sourceSettings)
            .values({ userId, source: name, enabled: request.body.enabled })
            .onConflictDoUpdate({
              target: [schema.sourceSettings.userId, schema.sourceSettings.source],
              set: { enabled: request.body.enabled, updatedAt: at },
            });
          await recordAudit(tx, {
            actorType: 'user',
            actorUserId: userId,
            action: 'source.switched',
            outcome: 'success',
            targetType: 'source',
            targetId: name,
            requestId: request.id,
            metadata: { enabled: request.body.enabled },
          });
          const [summary] = await summaries(tx, userId, name);
          return summary!;
        });
      },
    );

    app.get(
      '/api/sources/:name/runs',
      {
        schema: {
          params: sourceParamsSchema,
          querystring: sourceRunsQuerySchema,
          response: { 200: sourceRunsResponseSchema },
        },
      },
      async (request) => {
        const { userId } = requireSession(request);
        const { name } = request.params;
        if (!findConnector(name)) throw new HttpError(404, 'source_unknown');
        const runs = await withUser(deps.db, userId, (tx) =>
          tx
            .select()
            .from(schema.sourceRuns)
            .where(and(eq(schema.sourceRuns.userId, userId), eq(schema.sourceRuns.source, name)))
            .orderBy(desc(schema.sourceRuns.createdAt))
            .limit(request.query.limit),
        );
        return { runs: runs.map(toSourceRun) };
      },
    );

    app.post(
      '/api/sources/test',
      {
        config: {
          rateLimit: { max: settings.collect.test.requestsPerHour, timeWindow: '1 hour' },
        },
        schema: { body: sourceTestRequestSchema, response: { 200: passSchema } },
      },
      async (request) => {
        const { userId } = requireSession(request);
        if (!deps.queue) throw new HttpError(503, 'internal_error');
        const sources = plannedSources(connectors(), request.body.sources);
        const { pass, created } = await withUser(deps.db, userId, (tx) =>
          createPass(tx, settings, {
            userId,
            trigger: 'test',
            sources,
            actor: 'user',
            requestId: request.id,
          }),
        );
        if (created) await queuePass(deps.queue, userId, pass.id);
        return pass;
      },
    );

    app.get(
      '/api/sources/test',
      { schema: { response: { 200: latestTestResponseSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        return withUser(deps.db, userId, async (tx) => {
          const [latest] = await tx
            .select({ id: schema.collectionPasses.id })
            .from(schema.collectionPasses)
            .where(
              and(
                eq(schema.collectionPasses.userId, userId),
                eq(schema.collectionPasses.trigger, 'test'),
              ),
            )
            .orderBy(desc(schema.collectionPasses.createdAt))
            .limit(1);
          return { pass: latest ? await loadPass(tx, userId, latest.id) : null };
        });
      },
    );
  };
}
