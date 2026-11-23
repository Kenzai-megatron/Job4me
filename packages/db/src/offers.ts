import { and, eq, gte, inArray, sql } from 'drizzle-orm';
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

/**
 * Recomputes announcements from their postings: first and last sighting, and the retained
 * posting, which names the employer, then has the longest description, then comes first in
 * `sourceOrder` (the calling order), then was seen first. An announcement left without any
 * posting is deleted.
 */
export async function refreshOffers(
  tx: Transaction,
  userId: string,
  offerIds: readonly string[],
  sourceOrder: readonly string[],
  at: Date,
): Promise<void> {
  const order = sql`array[${sql.join(
    sourceOrder.map((name) => sql`${name}`),
    sql`, `,
  )}]::text[]`;
  for (const list of chunks([...new Set(offerIds)])) {
    await tx.execute(sql`
      update ${offers}
      set retained_id = retained.id,
        first_seen_at = retained.first_seen,
        last_seen_at = retained.last_seen,
        updated_at = ${at}
      from (
        select distinct on (${jobOffers.offerId}) ${jobOffers.offerId} as offer_id,
          ${jobOffers.id} as id,
          min(${jobOffers.firstSeenAt}) over (partition by ${jobOffers.offerId}) as first_seen,
          max(${jobOffers.lastSeenAt}) over (partition by ${jobOffers.offerId}) as last_seen
        from ${jobOffers}
        where ${jobOffers.userId} = ${userId} and ${inArray(jobOffers.offerId, list)}
        order by ${jobOffers.offerId},
          (${jobOffers.company} <> '?') desc,
          char_length(${jobOffers.description}) desc,
          array_position(${order}, ${jobOffers.source}) nulls last,
          ${jobOffers.firstSeenAt},
          ${jobOffers.id}
      ) as retained
      where ${offers.id} = retained.offer_id and ${offers.userId} = ${userId}
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
