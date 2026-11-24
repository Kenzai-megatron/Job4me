import { and, eq, gte, inArray, type SQL, sql } from 'drizzle-orm';
import type { Transaction } from './client';
import { jobOffers, offers } from './collect-schema';

// Announcements and their postings (ADR 0016): the storage side. The merge rules live in
// packages/collect; these helpers read the candidates, create announcements and recompute them
// from their postings, always for one account (its user_id filter, under row-level security).

const CHUNK = 500;

function chunks<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += CHUNK) {
    result.push(items.slice(index, index + CHUNK));
  }
  return result;
}

export interface HistoryPosting {
  postingId: string;
  offerId: string;
  source: string;
  url: string | null;
  company: string;
  key: string;
  bare: string;
  refs: string[];
  /** The announcement's latest sighting. */
  seenAt: Date;
}

/**
 * Stored postings that may be the same announcement as the ones looked for: the same content
 * key or the same bare title (every merge rule needs one or the other), in an announcement seen
 * since `since`. Rows not identified yet (phase 2, before the worker's start-up) are left out.
 */
export async function findHistoryPostings(
  tx: Transaction,
  userId: string,
  wanted: { keys: readonly string[]; bares: readonly string[] },
  since: Date,
): Promise<HistoryPosting[]> {
  const keys = [...new Set(wanted.keys)];
  const bares = [...new Set(wanted.bares.filter((bare) => bare !== ''))];
  const found = new Map<string, HistoryPosting>();
  const lookups = [
    ...chunks(keys).map((list) => inArray(jobOffers.contentKey, list)),
    ...chunks(bares).map((list) => inArray(jobOffers.bareTitle, list)),
  ];
  for (const condition of lookups) {
    const rows = await tx
      .select({
        postingId: jobOffers.id,
        offerId: jobOffers.offerId,
        source: jobOffers.source,
        url: jobOffers.url,
        company: jobOffers.company,
        key: jobOffers.contentKey,
        bare: jobOffers.bareTitle,
        refs: jobOffers.titleRefs,
        seenAt: offers.lastSeenAt,
      })
      .from(jobOffers)
      .innerJoin(offers, eq(offers.id, jobOffers.offerId))
      .where(
        and(
          eq(jobOffers.userId, userId),
          eq(offers.userId, userId),
          gte(offers.lastSeenAt, since),
          condition,
        ),
      );
    for (const row of rows) {
      if (row.key === null) continue;
      found.set(row.postingId, { ...row, key: row.key, bare: row.bare ?? '' });
    }
  }
  return [...found.values()];
}

/** New announcements, all alike until `refreshOffers` fills them from their postings. */
export async function createOffers(
  tx: Transaction,
  userId: string,
  count: number,
  at: Date,
): Promise<string[]> {
  const ids: string[] = [];
  for (let done = 0; done < count; done += CHUNK) {
    const rows = await tx
      .insert(offers)
      .values(
        Array.from({ length: Math.min(CHUNK, count - done) }, () => ({
          userId,
          firstSeenAt: at,
          lastSeenAt: at,
        })),
      )
      .returning({ id: offers.id });
    ids.push(...rows.map((row) => row.id));
  }
  return ids;
}

/** Where distances are measured from (the profile's base city), and the road factor. */
export interface OfferGeo {
  base: { latitude: number; longitude: number } | null;
  /** Road distance from the straight line (ADR 0017: 1.25). */
  roadFactor: number;
}

/**
 * Road distance in whole kilometres from the base city to a place: the straight line (haversine)
 * × the road factor, as packages/collect computes it; null without a base or a found place.
 */
function distanceSql(geo: OfferGeo, status: SQL, latitude: SQL, longitude: SQL): SQL {
  if (!geo.base) return sql`null::integer`;
  const { latitude: lat, longitude: lon } = geo.base;
  return sql`case when ${status} = 'found' then round(${geo.roadFactor}::double precision * 2 * 6371 * asin(sqrt(
      power(sin(radians(${latitude} - ${lat}::double precision) / 2), 2)
      + cos(radians(${lat}::double precision)) * cos(radians(${latitude}))
      * power(sin(radians(${longitude} - ${lon}::double precision) / 2), 2))))::integer end`;
}

/**
 * Recomputes announcements from their postings: first and last sighting; the retained posting,
 * which names the employer, then has the longest description, then comes first in
 * `sourceOrder` (the calling order), then was seen first; the place, the most precise of the
 * postings' (found with a postal code, found, abroad, unknown), its distance from the base city,
 * and remote work if one posting announces it. An announcement left without any posting is
 * deleted.
 */
export async function refreshOffers(
  tx: Transaction,
  userId: string,
  offerIds: readonly string[],
  sourceOrder: readonly string[],
  at: Date,
  geo: OfferGeo,
): Promise<void> {
  const order = sql`array[${sql.join(
    sourceOrder.map((name) => sql`${name}`),
    sql`, `,
  )}]::text[]`;
  const distance = distanceSql(
    geo,
    sql`placed.place_status`,
    sql`placed.latitude`,
    sql`placed.longitude`,
  );
  for (const list of chunks([...new Set(offerIds)])) {
    await tx.execute(sql`
      update ${offers}
      set retained_id = retained.id,
        first_seen_at = retained.first_seen,
        last_seen_at = retained.last_seen,
        place_status = placed.place_status,
        place_name = placed.place_name,
        postal_code = placed.postal_code,
        latitude = placed.latitude,
        longitude = placed.longitude,
        distance_km = ${distance},
        remote = retained.remote,
        updated_at = ${at}
      from (
        select distinct on (${jobOffers.offerId}) ${jobOffers.offerId} as offer_id,
          ${jobOffers.id} as id,
          min(${jobOffers.firstSeenAt}) over (partition by ${jobOffers.offerId}) as first_seen,
          max(${jobOffers.lastSeenAt}) over (partition by ${jobOffers.offerId}) as last_seen,
          case
            when bool_or(${jobOffers.remote} = 'full') over (partition by ${jobOffers.offerId}) then 'full'
            when bool_or(${jobOffers.remote} = 'hybrid') over (partition by ${jobOffers.offerId}) then 'hybrid'
          end as remote
        from ${jobOffers}
        where ${jobOffers.userId} = ${userId} and ${inArray(jobOffers.offerId, list)}
        order by ${jobOffers.offerId},
          (${jobOffers.company} <> '?') desc,
          char_length(${jobOffers.description}) desc,
          array_position(${order}, ${jobOffers.source}) nulls last,
          ${jobOffers.firstSeenAt},
          ${jobOffers.id}
      ) as retained,
      (
        select distinct on (${jobOffers.offerId}) ${jobOffers.offerId} as offer_id,
          ${jobOffers.placeStatus} as place_status, ${jobOffers.placeName} as place_name,
          ${jobOffers.postalCode} as postal_code, ${jobOffers.latitude} as latitude,
          ${jobOffers.longitude} as longitude
        from ${jobOffers}
        where ${jobOffers.userId} = ${userId} and ${inArray(jobOffers.offerId, list)}
        order by ${jobOffers.offerId},
          case ${jobOffers.placeStatus} when 'found' then 0 when 'abroad' then 1 when 'unknown' then 2 else 3 end,
          (${jobOffers.postalCode} is not null) desc,
          ${jobOffers.firstSeenAt},
          ${jobOffers.id}
      ) as placed
      where ${offers.id} = retained.offer_id and ${offers.id} = placed.offer_id
        and ${offers.userId} = ${userId}
    `);
    await tx
      .delete(offers)
      .where(
        and(
          eq(offers.userId, userId),
          inArray(offers.id, list),
          sql`not exists (select 1 from ${jobOffers} where ${jobOffers.offerId} = ${offers.id})`,
        ),
      );
  }
}

/** Distances of every announcement of an account again, after its base city changed. */
export async function updateDistances(
  tx: Transaction,
  userId: string,
  geo: OfferGeo,
  at: Date,
): Promise<void> {
  await tx
    .update(offers)
    .set({
      distanceKm: distanceSql(
        geo,
        sql`${offers.placeStatus}`,
        sql`${offers.latitude}`,
        sql`${offers.longitude}`,
      ),
      updatedAt: at,
    })
    .where(eq(offers.userId, userId));
}
