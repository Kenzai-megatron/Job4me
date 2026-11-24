import { createHash, randomUUID } from 'node:crypto';
import {
  availableConnectors,
  DEDUP_VERSION,
  employerWords,
  identify,
  placePostings,
  remoteOf,
} from '@job4me/collect';
import {
  manualOfferInputSchema,
  manualOfferResponseSchema,
  type Offer,
  offerParamsSchema,
  type OfferPosting,
  offerPostingSchema,
  offerSchema,
  offersQuerySchema,
  offersResponseSchema,
  offerUnmergeResponseSchema,
  offerUnmergeSchema,
} from '@job4me/contracts';
import {
  and,
  asc,
  count,
  createOffers,
  desc,
  eq,
  findHistoryPostings,
  inArray,
  type JobOfferRow,
  lt,
  ne,
  or,
  recordAudit,
  refreshOffers,
  schema,
  sql,
  type Transaction,
  withUser,
} from '@job4me/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../context';
import { HttpError } from '../../errors';
import { requireSession } from '../auth/guards';
import { baseOf, gazetteerOf, offerGeo } from './geo';

// Offers (phase 3 plan, sections 4 and 10; ADR 0016): announcements, each with every posting
// that carries it. Every query filters on the signed-in account and runs under row-level
// security for it (ADR 0011). A link is stored as given and never opened by the server.

const DAY_MS = 86_400_000;

function toPosting(row: JobOfferRow): OfferPosting {
  return offerPostingSchema.parse({
    id: row.id,
    source: row.source,
    origin: row.origin,
    title: row.title,
    company: row.company,
    location: row.location,
    postedOn: row.postedOn,
    url: row.url,
    mergeReason: row.mergeReason,
    place: { status: row.placeStatus, name: row.placeName, postalCode: row.postalCode },
    remote: row.remote,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  });
}

/** The announcements of these ids, in their order, each with its postings (retained first). */
export async function loadOffers(
  tx: Transaction,
  userId: string,
  ids: readonly string[],
): Promise<Offer[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select()
    .from(schema.offers)
    .where(and(eq(schema.offers.userId, userId), inArray(schema.offers.id, [...ids])));
  const postings = await tx
    .select()
    .from(schema.jobOffers)
    .where(and(eq(schema.jobOffers.userId, userId), inArray(schema.jobOffers.offerId, [...ids])))
    .orderBy(asc(schema.jobOffers.firstSeenAt), asc(schema.jobOffers.id));
  const byOffer = new Map<string, JobOfferRow[]>();
  for (const posting of postings) {
    const list = byOffer.get(posting.offerId);
    if (list) list.push(posting);
    else byOffer.set(posting.offerId, [posting]);
  }
  const offers = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const offer = offers.get(id);
    const list = byOffer.get(id) ?? [];
    const retained = list.find((posting) => posting.id === offer?.retainedId) ?? list[0];
    if (!offer || !retained) return [];
    return [
      offerSchema.parse({
        id: offer.id,
        title: retained.title,
        company: retained.company,
        location: retained.location,
        postedOn: retained.postedOn,
        url: retained.url,
        salary: retained.salary,
        details: retained.details,
        description: retained.description,
        firstSeenAt: offer.firstSeenAt.toISOString(),
        lastSeenAt: offer.lastSeenAt.toISOString(),
        place: {
          status: offer.placeStatus,
          name: offer.placeName,
          postalCode: offer.postalCode,
          distanceKm: offer.distanceKm,
        },
        remote: offer.remote,
        postings: [retained, ...list.filter((posting) => posting !== retained)].map(toPosting),
      }),
    ];
  });
}

/** A manual offer with a link is known by the link: the same one is not added twice. */
function manualId(url: string | null): string {
  if (!url) return `manual:${randomUUID()}`;
  return `url:${createHash('sha256').update(new URL(url).href).digest('hex').slice(0, 40)}`;
}

export function offerRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  const { settings } = deps.config;
  const now = () => deps.now?.() ?? new Date();
  /** Calling order: the first source called wins a tie for the retained posting. */
  const sourceOrder = () =>
    (deps.connectors ?? availableConnectors(settings)).map((connector) => connector.name);

  return async (app) => {
    app.get(
      '/api/offers',
      { schema: { querystring: offersQuerySchema, response: { 200: offersResponseSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const { source, before } = request.query;
        const limit = request.query.limit ?? settings.collect.offers.listLimit;
        const offers = schema.offers;
        const postings = schema.jobOffers;
        return withUser(deps.db, userId, async (tx) => {
          const conditions = [eq(offers.userId, userId)];
          if (source) {
            conditions.push(
              sql`exists (select 1 from ${postings} where ${postings.offerId} = ${offers.id} and ${postings.source} = ${source})`,
            );
          }
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
            .select({ id: offers.id })
            .from(offers)
            .where(and(...conditions))
            .orderBy(desc(offers.firstSeenAt), desc(offers.id))
            .limit(limit + 1);
          const page = rows.slice(0, limit);
          return {
            offers: await loadOffers(
              tx,
              userId,
              page.map((row) => row.id),
            ),
            nextCursor: rows.length > limit ? page.at(-1)!.id : null,
          };
        });
      },
    );

    app.get(
      '/api/offers/:id',
      { schema: { params: offerParamsSchema, response: { 200: offerSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const [offer] = await withUser(deps.db, userId, (tx) =>
          loadOffers(tx, userId, [request.params.id]),
        );
        if (!offer) throw new HttpError(404, 'not_found');
        return offer;
      },
    );

    // "Not the same offer": the posting leaves the announcement and starts its own. The next
    // passes never move it back (a posting stored before keeps its announcement).
    app.post(
      '/api/offers/:id/unmerge',
      {
        schema: {
          params: offerParamsSchema,
          body: offerUnmergeSchema,
          response: { 200: offerUnmergeResponseSchema },
        },
      },
      async (request) => {
        const { userId } = requireSession(request);
        const { id } = request.params;
        const { postingId } = request.body;
        const postings = schema.jobOffers;
        return withUser(deps.db, userId, async (tx) => {
          const [posting] = await tx
            .select()
            .from(postings)
            .where(
              and(
                eq(postings.id, postingId),
                eq(postings.userId, userId),
                eq(postings.offerId, id),
              ),
            );
          if (!posting) throw new HttpError(404, 'not_found');
          const [siblings] = await tx
            .select({ count: count() })
            .from(postings)
            .where(
              and(
                eq(postings.userId, userId),
                eq(postings.offerId, id),
                ne(postings.id, postingId),
              ),
            );
          if ((siblings?.count ?? 0) === 0) throw new HttpError(409, 'offer_not_merged');
          const at = now();
          const [detachedId] = await createOffers(tx, userId, 1, at);
          await tx
            .update(postings)
            .set({ offerId: detachedId!, mergeReason: null, updatedAt: at })
            .where(and(eq(postings.id, postingId), eq(postings.userId, userId)));
          const gazetteer = await gazetteerOf(deps.db, settings);
          const geo = offerGeo((await baseOf(tx, userId, gazetteer)).place, settings);
          await refreshOffers(tx, userId, [id, detachedId!], sourceOrder(), at, geo);
          await recordAudit(tx, {
            actorType: 'user',
            actorUserId: userId,
            action: 'offer.unmerged',
            outcome: 'success',
            targetType: 'offer',
            targetId: id,
            requestId: request.id,
            metadata: { postingId, detachedOfferId: detachedId!, source: posting.source },
          });
          const [offer, detached] = await loadOffers(tx, userId, [id, detachedId!]);
          return { offer: offer!, detached: detached! };
        });
      },
    );

    // Manual add: the link is stored as it is and never opened by the server (threat 1). The
    // offer joins an announcement already collected when the merge rules say so; two offers
    // added by hand are never merged together, each of them is meant.
    app.post(
      '/api/offers',
      {
        config: { rateLimit: { max: settings.collect.manual.addsPerHour, timeWindow: '1 hour' } },
        schema: { body: manualOfferInputSchema, response: { 200: manualOfferResponseSchema } },
      },
      async (request) => {
        const { userId } = requireSession(request);
        const input = request.body;
        if ((input.text?.length ?? 0) > settings.collect.manual.maxTextChars) {
          throw new HttpError(400, 'validation_error');
        }
        const at = now();
        const company = input.company ?? '?';
        const identity = identify(input.title, company);
        const since = new Date(at.getTime() - settings.collect.offers.historyDays * DAY_MS);
        const gazetteer = await gazetteerOf(deps.db, settings);
        const place = gazetteer.locate(input.location);
        const found = place.status === 'found' ? place : null;
        return withUser(deps.db, userId, async (tx) => {
          const stored = await findHistoryPostings(
            tx,
            userId,
            { keys: [identity.key], bares: [identity.bare] },
            since,
          );
          const [placement] = placePostings(
            [{ source: 'manual', url: input.url, identity, known: null }],
            stored
              .filter((row) => row.source !== 'manual')
              .map((row) => ({
                postingId: row.postingId,
                offerId: row.offerId,
                source: row.source,
                url: row.url,
                identity: {
                  key: row.key,
                  bare: row.bare,
                  refs: row.refs,
                  employer: employerWords(row.company),
                },
                seenAt: row.seenAt,
              })),
          );
          const joined = placement?.kind === 'joined' ? placement : null;
          const offerId = joined ? joined.offerId : (await createOffers(tx, userId, 1, at))[0]!;
          const [row] = await tx
            .insert(schema.jobOffers)
            .values({
              userId,
              offerId,
              source: 'manual',
              origin: 'manual',
              externalId: manualId(input.url),
              title: input.title,
              company,
              location: input.location ?? '?',
              url: input.url,
              description: input.text ?? '',
              firstSeenAt: at,
              lastSeenAt: at,
              contentKey: identity.key,
              bareTitle: identity.bare,
              titleRefs: identity.refs,
              dedupVersion: DEDUP_VERSION,
              mergeReason: joined?.reason ?? null,
              placeStatus: place.status,
              placeName: found?.name ?? null,
              postalCode: found?.postalCode ?? null,
              latitude: found?.latitude ?? null,
              longitude: found?.longitude ?? null,
              remote: remoteOf({
                location: input.location,
                title: input.title,
                description: input.text,
              }),
            })
            .onConflictDoNothing()
            .returning();
          if (!row) throw new HttpError(409, 'duplicate');
          const geo = offerGeo((await baseOf(tx, userId, gazetteer)).place, settings);
          await refreshOffers(tx, userId, [offerId], sourceOrder(), at, geo);
          await recordAudit(tx, {
            actorType: 'user',
            actorUserId: userId,
            action: 'offer.added',
            outcome: 'success',
            targetType: 'job_offer',
            targetId: row.id,
            requestId: request.id,
            metadata: { offerId, merged: joined !== null },
          });
          const [offer] = await loadOffers(tx, userId, [offerId]);
          return { offer: offer!, merged: joined !== null };
        });
      },
    );
  };
}
