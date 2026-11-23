import { createHash, randomUUID } from 'node:crypto';
import { availableConnectors, lockedByUsageMode, sourceSettings } from '@job4me/collect';
import {
  latestTestResponseSchema,
  manualOfferInputSchema,
  type Offer,
  offerSchema,
  offersQuerySchema,
  offersResponseSchema,
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
  type JobOfferRow,
  lt,
  or,
  recordAudit,
  schema,
  type Transaction,
  withUser,
} from '@job4me/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../context';
import { HttpError } from '../../errors';
import { requireSession } from '../auth/guards';
import { createPass, loadPass, plannedSources, queuePass, toSourceRun } from './passes';

// Sources and offers (phase 2 plan, section 8). Every query filters on the signed-in account and
// runs under row-level security for it (ADR 0011).

function toOffer(row: JobOfferRow): Offer {
  return offerSchema.parse({
    id: row.id,
    source: row.source,
    origin: row.origin,
    title: row.title,
    company: row.company,
    location: row.location,
    postedOn: row.postedOn,
    url: row.url,
    salary: row.salary,
    details: row.details,
    description: row.description,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  });
}

/** A manual offer with a link is known by the link: the same one is not added twice. */
function manualId(url: string | null): string {
  if (!url) return `manual:${randomUUID()}`;
  return `url:${createHash('sha256').update(new URL(url).href).digest('hex').slice(0, 40)}`;
}

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
    const result: SourceSummary[] = [];
    for (const connector of connectors()) {
      if (only && connector.name !== only) continue;
      const config = sourceSettings(settings, connector.name);
      const row = byName.get(connector.name);
      const locked = lockedByUsageMode(connector, settings);
      const runs = await tx
        .select()
        .from(schema.sourceRuns)
        .where(
          and(eq(schema.sourceRuns.userId, userId), eq(schema.sourceRuns.source, connector.name)),
        )
        .orderBy(desc(schema.sourceRuns.createdAt))
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
          runs: runs.map(toSourceRun),
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

    app.get(
      '/api/offers',
      { schema: { querystring: offersQuerySchema, response: { 200: offersResponseSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const { source, before } = request.query;
        const limit = request.query.limit ?? settings.collect.offers.listLimit;
        const offers = schema.jobOffers;
        return withUser(deps.db, userId, async (tx) => {
          const conditions = [eq(offers.userId, userId)];
          if (source) conditions.push(eq(offers.source, source));
          if (before) {
            const [cursor] = await tx
              .select({ firstSeenAt: offers.firstSeenAt, id: offers.id })
              .from(offers)
              .where(and(eq(offers.id, before), eq(offers.userId, userId)));
            if (!cursor) throw new HttpError(400, 'validation_error');
            conditions.push(
              or(
                lt(offers.firstSeenAt, cursor.firstSeenAt),
                and(eq(offers.firstSeenAt, cursor.firstSeenAt), lt(offers.id, cursor.id)),
              )!,
            );
          }
          const rows = await tx
            .select()
            .from(offers)
            .where(and(...conditions))
            .orderBy(desc(offers.firstSeenAt), desc(offers.id))
            .limit(limit + 1);
          const page = rows.slice(0, limit);
          return {
            offers: page.map(toOffer),
            nextCursor: rows.length > limit ? page.at(-1)!.id : null,
          };
        });
      },
    );

    // Manual add: the link is stored as it is and never opened by the server (threat 1).
    app.post(
      '/api/offers',
      {
        config: { rateLimit: { max: settings.collect.manual.addsPerHour, timeWindow: '1 hour' } },
        schema: { body: manualOfferInputSchema, response: { 200: offerSchema } },
      },
      async (request) => {
        const { userId } = requireSession(request);
        const input = request.body;
        if ((input.text?.length ?? 0) > settings.collect.manual.maxTextChars) {
          throw new HttpError(400, 'validation_error');
        }
        const at = now();
        return withUser(deps.db, userId, async (tx) => {
          const [row] = await tx
            .insert(schema.jobOffers)
            .values({
              userId,
              source: 'manual',
              origin: 'manual',
              externalId: manualId(input.url),
              title: input.title,
              company: input.company ?? '?',
              location: input.location ?? '?',
              url: input.url,
              description: input.text ?? '',
              firstSeenAt: at,
              lastSeenAt: at,
            })
            .onConflictDoNothing()
            .returning();
          if (!row) throw new HttpError(409, 'duplicate');
          await recordAudit(tx, {
            actorType: 'user',
            actorUserId: userId,
            action: 'offer.added',
            outcome: 'success',
            targetType: 'job_offer',
            targetId: row.id,
            requestId: request.id,
          });
          return toOffer(row);
        });
      },
    );
  };
}
