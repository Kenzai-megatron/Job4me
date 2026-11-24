import type { Settings } from '@job4me/config';
import {
  type CollectedOffer,
  DEDUP_VERSION,
  employerWords,
  type Gazetteer,
  identify,
  type IncomingPosting,
  type Place,
  type Placement,
  placePostings,
  type PostingIdentity,
  remoteOf,
  type ScreenProfile,
  type StoredPosting,
} from '@job4me/collect';
import type { PassTrigger } from '@job4me/contracts';
import {
  and,
  asc,
  createOffers,
  type Database,
  eq,
  findHistoryPostings,
  inArray,
  isNull,
  lt,
  type OfferGeo,
  or,
  refreshOffers,
  schema,
  sql,
  type Transaction,
  withUser,
} from '@job4me/db';
import type { Logger } from '@job4me/logger';
import { screenOffers, screenProfileOf } from './screen';
import { type ScoringContext, scoreOffers, scoringContextOf } from './scoring';

// Postings and their announcements (ADR 0016). Each posting of a run is placed by the merge
// rules of packages/collect: its own announcement when it was stored before, one it joins, or a
// new one. A test pass places them without writing anything, so its log still says how many
// announcements were new and how many postings were merged. Each posting is also located in the
// Belgian localities, with the remote work it announces (ADR 0017); the announcement takes the
// most precise place of its postings and its distance from the profile's base city.

const DAY_MS = 86_400_000;
const CHUNK = 500;

export interface StoreContext {
  userId: string;
  source: string;
  trigger: PassTrigger;
  at: Date;
  settings: Settings;
  /** Source names in calling order: the first one called wins a tie for the retained posting. */
  sourceOrder: readonly string[];
  gazetteer: Gazetteer;
  /** Distances are measured from the profile's base city. */
  geo: OfferGeo;
  /** The criteria of the deterministic filter (phase 3 plan, section 6). */
  screen: ScreenProfile;
  /** What the scoring without AI reads (phase 3 plan, section 7). */
  scoring: ScoringContext;
}

/** Where distances are measured from: the base city, when the localities know it. */
export function offerGeo(base: Place, settings: Settings): OfferGeo {
  return {
    base: base.status === 'found' ? { latitude: base.latitude, longitude: base.longitude } : null,
    roadFactor: settings.geo.roadFactor,
  };
}

/** The base city of an account's profile, read in the localities. */
export async function baseOf(tx: Transaction, userId: string, gazetteer: Gazetteer) {
  const [profile] = await tx
    .select({ city: schema.profiles.baseCity, code: schema.profiles.basePostalCode })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId));
  return gazetteer.locateBase(profile?.city ?? null, profile?.code ?? null);
}

/** The columns of a posting's place (ADR 0017). */
function placeColumns(place: Place, remote: ReturnType<typeof remoteOf>) {
  const found = place.status === 'found' ? place : null;
  return {
    placeStatus: place.status,
    placeName: found?.name ?? null,
    postalCode: found?.postalCode ?? null,
    latitude: found?.latitude ?? null,
    longitude: found?.longitude ?? null,
    remote,
  };
}

export interface StoreResult {
  /** New announcements. */
  newCount: number;
  /** Postings that joined an announcement already there, or one started earlier in the run. */
  mergedCount: number;
}

const toStored = (row: Awaited<ReturnType<typeof findHistoryPostings>>[number]): StoredPosting => ({
  postingId: row.postingId,
  offerId: row.offerId,
  source: row.source,
  url: row.url,
  identity: { key: row.key, bare: row.bare, refs: row.refs, employer: employerWords(row.company) },
  seenAt: row.seenAt,
});

/** The stored announcements a run may join: seen within the history window. */
async function storedFor(
  tx: Transaction,
  userId: string,
  identities: readonly PostingIdentity[],
  since: Date,
): Promise<StoredPosting[]> {
  const rows = await findHistoryPostings(
    tx,
    userId,
    { keys: identities.map((item) => item.key), bares: identities.map((item) => item.bare) },
    since,
  );
  return rows.map(toStored);
}

/** The announcement of each placement, new ones taken in order from `created`. */
function offerIds(placements: readonly Placement[], created: readonly string[]): string[] {
  const ids: string[] = [];
  let next = 0;
  placements.forEach((placement, index) => {
    if (placement.kind === 'new') ids[index] = created[next++]!;
    else if (placement.kind === 'grouped') ids[index] = ids[placement.leader]!;
    else ids[index] = placement.offerId;
  });
  return ids;
}

const reasonOf = (placement: Placement) =>
  placement.kind === 'joined' || placement.kind === 'grouped' ? placement.reason : null;

/** Writes the kept postings of a run with their announcements; a test pass writes nothing. */
export async function storePostings(
  tx: Transaction,
  context: StoreContext,
  kept: readonly CollectedOffer[],
): Promise<StoreResult> {
  if (kept.length === 0) return { newCount: 0, mergedCount: 0 };
  const { userId, source, at } = context;
  const postings = schema.jobOffers;
  const identities = kept.map((offer) => identify(offer.title, offer.company));

  // Stored before at this source: they keep their announcement, whatever the rules say now.
  const known = new Map<string, { postingId: string; offerId: string }>();
  for (let index = 0; index < kept.length; index += CHUNK) {
    const ids = kept.slice(index, index + CHUNK).map((offer) => offer.externalId);
    const rows = await tx
      .select({ id: postings.id, externalId: postings.externalId, offerId: postings.offerId })
      .from(postings)
      .where(
        and(
          eq(postings.userId, userId),
          eq(postings.source, source),
          inArray(postings.externalId, ids),
        ),
      );
    for (const row of rows) known.set(row.externalId, { postingId: row.id, offerId: row.offerId });
  }

  const since = new Date(at.getTime() - context.settings.collect.offers.historyDays * DAY_MS);
  const stored = await storedFor(tx, userId, identities, since);
  const incoming: IncomingPosting[] = kept.map((offer, index) => ({
    source,
    url: offer.url,
    identity: identities[index]!,
    known: known.get(offer.externalId) ?? null,
  }));
  const placements = placePostings(incoming, stored);
  const result = {
    newCount: placements.filter((placement) => placement.kind === 'new').length,
    mergedCount: placements.filter(
      (placement) => placement.kind === 'joined' || placement.kind === 'grouped',
    ).length,
  };
  // "Test the sources" writes its log, never offers (ADR 0013).
  if (context.trigger === 'test') return result;

  const created = await createOffers(tx, userId, result.newCount, at);
  const targets = offerIds(placements, created);
  for (let index = 0; index < kept.length; index += CHUNK) {
    await tx
      .insert(postings)
      .values(
        kept.slice(index, index + CHUNK).map((offer, offset) => {
          const position = index + offset;
          const identity = identities[position]!;
          return {
            userId,
            offerId: targets[position]!,
            source,
            externalId: offer.externalId,
            origin: 'collected',
            title: offer.title,
            company: offer.company,
            location: offer.location,
            postedOn: offer.postedAt,
            url: offer.url,
            salary: offer.salary,
            description: offer.description,
            details: offer.details,
            firstSeenAt: at,
            lastSeenAt: at,
            contentKey: identity.key,
            bareTitle: identity.bare,
            titleRefs: identity.refs,
            dedupVersion: DEDUP_VERSION,
            mergeReason: reasonOf(placements[position]!),
            ...placeColumns(context.gazetteer.locate(offer.location), remoteOf(offer)),
            contracts: offer.contracts,
            languages: offer.languages,
          };
        }),
      )
      // A posting stored before stays in its announcement: neither its announcement nor its
      // reason change, an undone merge stays undone.
      .onConflictDoUpdate({
        target: [postings.userId, postings.source, postings.externalId],
        set: {
          title: sql`excluded.title`,
          company: sql`excluded.company`,
          location: sql`excluded.location`,
          postedOn: sql`coalesce(excluded.posted_on, ${postings.postedOn})`,
          url: sql`excluded.url`,
          salary: sql`excluded.salary`,
          description: sql`excluded.description`,
          details: sql`excluded.details`,
          contentKey: sql`excluded.content_key`,
          bareTitle: sql`excluded.bare_title`,
          titleRefs: sql`excluded.title_refs`,
          dedupVersion: sql`excluded.dedup_version`,
          placeStatus: sql`excluded.place_status`,
          placeName: sql`excluded.place_name`,
          postalCode: sql`excluded.postal_code`,
          latitude: sql`excluded.latitude`,
          longitude: sql`excluded.longitude`,
          remote: sql`excluded.remote`,
          contracts: sql`excluded.contracts`,
          languages: sql`excluded.languages`,
          lastSeenAt: at,
          updatedAt: at,
        },
      });
  }
  await refreshOffers(tx, userId, targets, context.sourceOrder, at, context.geo);
  await screenOffers(tx, userId, targets, context.screen, at);
  await scoreOffers(tx, userId, targets, context.scoring, at);
  return result;
}

export interface StartupDeps {
  db: Database;
  logger: Logger;
  gazetteer: Gazetteer;
  settings: Settings;
}

export interface StartupCounts {
  identified: number;
  regrouped: number;
  located: number;
  /** Announcements read by the deterministic filter for the first time. */
  screened: number;
  /** Scores written (announcements never scored, or whose profile or offer changed). */
  scored: number;
}

/**
 * Postings stored before their identity existed (phase 2) or under an older normalization: the
 * identity is computed again. Those never identified were alone in their announcement
 * (migration 0009): the ones that are the same announcement are regrouped once, by the history
 * rules, in the order they were first seen. Returns the announcements to refresh.
 */
async function identifyStored(
  tx: Transaction,
  userId: string,
  now: Date,
  touched: Set<string>,
): Promise<{ identified: number; regrouped: number }> {
  const postings = schema.jobOffers;
  const rows = await tx
    .select({
      id: postings.id,
      offerId: postings.offerId,
      source: postings.source,
      url: postings.url,
      title: postings.title,
      company: postings.company,
      version: postings.dedupVersion,
    })
    .from(postings)
    .where(and(eq(postings.userId, userId), lt(postings.dedupVersion, DEDUP_VERSION)))
    .orderBy(asc(postings.firstSeenAt), asc(postings.id));
  if (rows.length === 0) return { identified: 0, regrouped: 0 };
  const identities = rows.map((row) => identify(row.title, row.company));
  for (let index = 0; index < rows.length; index += CHUNK) {
    const values = rows.slice(index, index + CHUNK).map((row, offset) => {
      const identity = identities[index + offset]!;
      const refs = sql`array[${sql.join(
        identity.refs.map((ref) => sql`${ref}`),
        sql`, `,
      )}]::text[]`;
      return sql`(${row.id}::uuid, ${identity.key}, ${identity.bare}, ${refs})`;
    });
    await tx.execute(sql`
      update ${postings}
      set content_key = identified.key, bare_title = identified.bare,
        title_refs = identified.refs, dedup_version = ${DEDUP_VERSION}, updated_at = ${now}
      from (values ${sql.join(values, sql`, `)}) as identified (id, key, bare, refs)
      where ${postings.id} = identified.id and ${postings.userId} = ${userId}
    `);
  }

  // Regrouped once: the postings never identified, each alone in its announcement. An offer
  // added by hand stays where it is (collected postings may join it): two of them are never
  // merged together, each was meant.
  const fresh = rows.flatMap((row, index) => (row.version === 0 ? [index] : []));
  const placements = placePostings(
    fresh.map((index) => {
      const row = rows[index]!;
      return {
        source: row.source,
        url: row.url,
        identity: identities[index]!,
        known: row.source === 'manual' ? { postingId: row.id, offerId: row.offerId } : null,
      };
    }),
    [],
    'history',
  );
  let moved = 0;
  for (const [position, placement] of placements.entries()) {
    if (placement.kind !== 'grouped' && placement.kind !== 'joined') continue;
    const row = rows[fresh[position]!]!;
    // Joined: an offer added by hand; grouped: the first posting of the announcement.
    const target =
      placement.kind === 'joined' ? placement.offerId : rows[fresh[placement.leader]!]!.offerId;
    await tx
      .update(postings)
      .set({ offerId: target, mergeReason: placement.reason, updatedAt: now })
      .where(and(eq(postings.id, row.id), eq(postings.userId, userId)));
    touched.add(target).add(row.offerId);
    moved += 1;
  }
  return { identified: rows.length, regrouped: moved };
}

/** Postings stored before the geography (ADR 0017): located once, with their remote work. */
async function locateStored(
  tx: Transaction,
  userId: string,
  gazetteer: Gazetteer,
  now: Date,
  touched: Set<string>,
): Promise<number> {
  const postings = schema.jobOffers;
  const rows = await tx
    .select({
      id: postings.id,
      offerId: postings.offerId,
      location: postings.location,
      title: postings.title,
      description: postings.description,
    })
    .from(postings)
    .where(and(eq(postings.userId, userId), isNull(postings.placeStatus)));
  for (let index = 0; index < rows.length; index += CHUNK) {
    const values = rows.slice(index, index + CHUNK).map((row) => {
      const place = placeColumns(gazetteer.locate(row.location), remoteOf(row));
      touched.add(row.offerId);
      return sql`(${row.id}::uuid, ${place.placeStatus}::text, ${place.placeName}::text,
        ${place.postalCode}::text, ${place.latitude}::double precision,
        ${place.longitude}::double precision, ${place.remote}::text)`;
    });
    await tx.execute(sql`
      update ${postings}
      set place_status = located.status, place_name = located.name,
        postal_code = located.code, latitude = located.latitude, longitude = located.longitude,
        remote = located.remote, updated_at = ${now}
      from (values ${sql.join(values, sql`, `)})
        as located (id, status, name, code, latitude, longitude, remote)
      where ${postings.id} = located.id and ${postings.userId} = ${userId}
    `);
  }
  return rows.length;
}

/**
 * At the worker's start-up, account by account: postings without their identity (ADR 0016) or
 * their place (ADR 0017) get them, and their announcements are refreshed, distances included.
 */
export async function prepareStoredPostings(
  deps: StartupDeps,
  sourceOrder: readonly string[],
  now: Date = new Date(),
): Promise<StartupCounts> {
  const accounts = await deps.db.select({ id: schema.users.id }).from(schema.users);
  const total: StartupCounts = {
    identified: 0,
    regrouped: 0,
    located: 0,
    screened: 0,
    scored: 0,
  };
  for (const account of accounts) {
    const userId = account.id;
    const counts = await withUser(deps.db, userId, async (tx) => {
      const pending = await tx
        .select({ id: schema.jobOffers.id })
        .from(schema.jobOffers)
        .where(
          and(
            eq(schema.jobOffers.userId, userId),
            or(
              lt(schema.jobOffers.dedupVersion, DEDUP_VERSION),
              isNull(schema.jobOffers.placeStatus),
            ),
          ),
        )
        .limit(1);
      const unscreened = await tx
        .select({ id: schema.offers.id })
        .from(schema.offers)
        .where(and(eq(schema.offers.userId, userId), isNull(schema.offers.screenedAt)))
        .limit(1);
      const unscored = await tx
        .select({ id: schema.offers.id })
        .from(schema.offers)
        .leftJoin(schema.offerScores, eq(schema.offerScores.offerId, schema.offers.id))
        .where(
          and(
            eq(schema.offers.userId, userId),
            isNull(schema.offers.excludedReason),
            isNull(schema.offerScores.id),
          ),
        )
        .limit(1);
      if (pending.length === 0 && unscreened.length === 0 && unscored.length === 0) {
        return { identified: 0, regrouped: 0, located: 0, screened: 0, scored: 0 };
      }
      const touched = new Set<string>();
      const identity = await identifyStored(tx, userId, now, touched);
      const located = await locateStored(tx, userId, deps.gazetteer, now, touched);
      const geo = offerGeo(await baseOf(tx, userId, deps.gazetteer), deps.settings);
      await refreshOffers(tx, userId, [...touched], sourceOrder, now, geo);
      // The deterministic filter (phase 3 plan, section 6) on what changed and was never read.
      const criteria = await screenProfileOf(tx, userId, deps.settings, now);
      await screenOffers(tx, userId, [...touched], criteria, now);
      const { screened } = await screenOffers(tx, userId, 'unscreened', criteria, now);
      // The scoring without AI (phase 3 plan, section 7) on what changed and was never scored.
      const scoring = await scoringContextOf(tx, userId, deps.settings, now);
      const changed = await scoreOffers(tx, userId, [...touched], scoring, now);
      const fresh = await scoreOffers(tx, userId, 'unscored', scoring, now);
      return { ...identity, located, screened, scored: changed.scored + fresh.scored };
    });
    total.identified += counts.identified;
    total.regrouped += counts.regrouped;
    total.located += counts.located;
    total.screened += counts.screened;
    total.scored += counts.scored;
  }
  if (total.identified + total.located + total.screened + total.scored > 0) {
    deps.logger.info(total, 'stored postings prepared');
  }
  return total;
}
