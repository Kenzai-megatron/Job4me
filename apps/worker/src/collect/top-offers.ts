import type { Settings } from '@job4me/config';
import { and, type Database, eq, gte, inArray, isNull, schema, sql, withUser } from '@job4me/db';
import { resources } from '@job4me/i18n';
import type { Logger } from '@job4me/logger';
import type { PushMessage } from '../notify';

// Decision D7 (phase 3 plan, section 10): after a pass (after the scoring by Claude when it is
// on), one notification of the new offers of 80 or more: kept, first seen within the week, never
// named by an earlier notification, never an offer Mehdi added himself.

const DAY_MS = 86_400_000;

export interface TopOffersDeps {
  db: Database;
  settings: Settings;
  logger: Logger;
  /** Absent without push keys: the offers are still marked, the home page shows them. */
  notify?: (userId: string, message: PushMessage) => Promise<unknown>;
  now?: () => Date;
}

/** Tells the phone of the new offers of 80 or more; returns how many it named. */
export async function alertTopOffers(deps: TopOffersDeps, userId: string): Promise<number> {
  const { threshold, freshDays } = deps.settings.scoring.alert;
  const now = deps.now?.() ?? new Date();
  const offers = schema.offers;
  const scores = schema.offerScores;
  const postings = schema.jobOffers;
  const fresh = await withUser(deps.db, userId, (tx) =>
    tx
      .select({ id: offers.id })
      .from(offers)
      .innerJoin(scores, eq(scores.offerId, offers.id))
      .where(
        and(
          eq(offers.userId, userId),
          isNull(offers.excludedReason),
          isNull(offers.alertedAt),
          gte(offers.firstSeenAt, new Date(now.getTime() - freshDays * DAY_MS)),
          gte(scores.score, threshold),
          sql`not exists (select 1 from ${postings} where ${postings.offerId} = ${offers.id} and ${postings.origin} = 'manual')`,
        ),
      ),
  );
  if (fresh.length === 0) return 0;
  const texts = resources.fr.translation.notifications;
  const body = (fresh.length === 1 ? texts.topBody_one : texts.topBody_other)
    .replace('{{count}}', String(fresh.length))
    .replace('{{threshold}}', String(threshold));
  if (deps.notify) {
    try {
      await deps.notify(userId, { title: texts.topTitle, body, url: '/' });
    } catch (error) {
      deps.logger.warn(
        { err: error instanceof Error ? error.message : 'unknown' },
        'top offers notification failed',
      );
    }
  }
  // Named once (or no device to tell): the home page lists them all the week anyway.
  await withUser(deps.db, userId, (tx) =>
    tx
      .update(offers)
      .set({ alertedAt: now })
      .where(
        and(
          eq(offers.userId, userId),
          inArray(
            offers.id,
            fresh.map((row) => row.id),
          ),
        ),
      ),
  );
  deps.logger.info({ offers: fresh.length }, 'new top offers told');
  return fresh.length;
}
