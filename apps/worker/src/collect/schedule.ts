import type { Settings } from '@job4me/config';
import { type Connector, sourceSettings } from '@job4me/collect';
import { type CollectPassJob, QUEUES } from '@job4me/contracts';
import { and, type Database, eq, lt, schema, sql, withUser } from '@job4me/db';
import type { Logger } from '@job4me/logger';

// The daily schedule (decision D3): every morning, one pass per active account with the
// sources due that weekday (APIs and open data every day, public pages and LinkedIn on Tuesday
// and Friday). The passes then run one after another from the collect_pass queue.

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const DAY_MS = 86_400_000;

/** ISO weekday (1 = Monday) of an instant in a time zone. */
export function isoWeekday(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  return WEEKDAYS[name] ?? 1;
}

/** The sources due on that day, in calling order. */
export function dueSources(
  connectors: readonly Connector[],
  settings: Settings,
  instant: Date,
): string[] {
  const weekday = isoWeekday(instant, settings.collect.schedule.timeZone);
  return connectors
    .filter((connector) => sourceSettings(settings, connector.name).weekdays.includes(weekday))
    .map((connector) => connector.name);
}

export interface ScheduleDeps {
  db: Database;
  settings: Settings;
  logger: Logger;
  connectors: readonly Connector[];
  queue: { send(name: string, data: CollectPassJob): Promise<string | null> };
}

export async function schedulePasses(deps: ScheduleDeps, now: Date = new Date()) {
  const sources = dueSources(deps.connectors, deps.settings, now);
  if (sources.length === 0) return { passes: 0 };
  const accounts = await deps.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.status, 'active'));
  for (const account of accounts) {
    const [pass] = await withUser(deps.db, account.id, (tx) =>
      tx
        .insert(schema.collectionPasses)
        .values({ userId: account.id, trigger: 'scheduled', sources })
        .returning({ id: schema.collectionPasses.id }),
    );
    await deps.queue.send(QUEUES.collectPass, { userId: account.id, passId: pass!.id });
  }
  deps.logger.info({ accounts: accounts.length, sources }, 'collection passes scheduled');
  return { passes: accounts.length };
}

/**
 * Hourly purge (ADR 0015): announcements not seen for the configured time (their postings go
 * with them, ADR 0016), then pass logs (their runs go with them) older than their retention.
 * Account by account, under row-level security.
 */
export async function purgeCollection(db: Database, settings: Settings, now: Date = new Date()) {
  const offerCutoff = new Date(now.getTime() - settings.collect.offers.retentionDays * DAY_MS);
  const passCutoff = new Date(now.getTime() - settings.collect.runs.retentionDays * DAY_MS);
  const accounts = await db.select({ id: schema.users.id }).from(schema.users);
  let offers = 0;
  let passes = 0;
  for (const account of accounts) {
    await withUser(db, account.id, async (tx) => {
      // An offer Mehdi rated stays: the reference set measures the scorings (decision D1).
      const gone = await tx
        .delete(schema.offers)
        .where(
          and(
            eq(schema.offers.userId, account.id),
            lt(schema.offers.lastSeenAt, offerCutoff),
            sql`not exists (select 1 from ${schema.offerRatings} where ${schema.offerRatings.offerId} = ${schema.offers.id})`,
          ),
        )
        .returning({ id: schema.offers.id });
      const old = await tx
        .delete(schema.collectionPasses)
        .where(
          and(
            eq(schema.collectionPasses.userId, account.id),
            lt(schema.collectionPasses.createdAt, passCutoff),
          ),
        )
        .returning({ id: schema.collectionPasses.id });
      // The measures of the reference set name a few offers (their widest gaps): kept as long as
      // the pass logs, never longer (security review of phase 3, finding 2).
      await tx
        .delete(schema.scoringBenchmarks)
        .where(
          and(
            eq(schema.scoringBenchmarks.userId, account.id),
            lt(schema.scoringBenchmarks.createdAt, passCutoff),
          ),
        );
      offers += gone.length;
      passes += old.length;
    });
  }
  return { offers, passes };
}
