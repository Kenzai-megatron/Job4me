import type { Settings } from '@job4me/config';
import type { SourceAlertKind } from '@job4me/contracts';
import { and, type Database, desc, eq, inArray, lt, schema, withUser } from '@job4me/db';
import { resources } from '@job4me/i18n';
import type { Logger } from '@job4me/logger';
import type { PushMessage } from '../notify';

// Silent source (ADR 0013, decision D4): after every scheduled or manual pass, a source that
// read nothing without any error, or far less than its usual volume, raises an alert. It shows
// as a banner on the Sources screen, and the phone hears of it once per incident. A source is
// judged on what it read, never on what passed the title filter (docs/SOURCES.md, section 1.9).

export interface AlertDeps {
  db: Database;
  settings: Settings;
  logger: Logger;
  /** Sends a notification to the account's devices; absent without push keys. */
  notify?: (userId: string, message: PushMessage) => Promise<unknown>;
  now?: () => Date;
}

export interface SourceAlertOutcome {
  source: string;
  kind: SourceAlertKind | null;
  read: number;
  usual: number | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The kind of alert a run raises, if any, given the runs that came before it. */
export function judgeRun(
  run: { status: string; readCount: number },
  previous: number[],
  settings: Settings['collect']['mute'],
): { kind: SourceAlertKind | null; usual: number | null } {
  const usual = previous.length >= 3 ? Math.round(median(previous)) : null;
  if (run.status === 'succeeded' && run.readCount === 0) return { kind: 'zero_read', usual };
  if (
    usual !== null &&
    usual >= settings.minUsual &&
    run.readCount < usual * settings.collapseRatio
  ) {
    return { kind: 'collapse', usual };
  }
  return { kind: null, usual };
}

/** Judges every source a pass ran, keeps the alerts up to date and tells the phone once. */
export async function checkSilentSources(
  deps: AlertDeps,
  userId: string,
  passId: string,
): Promise<SourceAlertOutcome[]> {
  const now = deps.now?.() ?? new Date();
  const runs = schema.sourceRuns;
  const settings = schema.sourceSettings;
  const { mute } = deps.settings.collect;
  const fresh: string[] = [];

  const outcomes = await withUser(deps.db, userId, async (tx) => {
    // A failed source is in error, a skipped one was not called: neither is silent.
    const ran = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.userId, userId),
          eq(runs.passId, passId),
          inArray(runs.status, ['succeeded', 'partial']),
        ),
      );
    const results: SourceAlertOutcome[] = [];
    for (const run of ran) {
      const previous = await tx
        .select({ readCount: runs.readCount })
        .from(runs)
        .where(
          and(
            eq(runs.userId, userId),
            eq(runs.source, run.source),
            inArray(runs.trigger, ['scheduled', 'manual']),
            inArray(runs.status, ['succeeded', 'partial']),
            lt(runs.createdAt, run.createdAt),
          ),
        )
        .orderBy(desc(runs.createdAt))
        .limit(mute.history);
      const { kind, usual } = judgeRun(
        run,
        previous.map((row) => row.readCount),
        mute,
      );
      results.push({ source: run.source, kind, read: run.readCount, usual });
      const [setting] = await tx
        .select()
        .from(settings)
        .where(and(eq(settings.userId, userId), eq(settings.source, run.source)));
      if (kind === null) {
        if (setting?.alert) {
          await tx
            .update(settings)
            .set({
              alert: null,
              alertSince: null,
              alertRead: null,
              alertUsual: null,
              alertNotifiedAt: null,
              updatedAt: now,
            })
            .where(eq(settings.id, setting.id));
        }
        continue;
      }
      // The same incident goes on: its figures change, not its start nor the notice sent.
      const same = setting?.alert === kind;
      const values = {
        alert: kind,
        alertSince: same ? setting.alertSince : now,
        alertRead: run.readCount,
        alertUsual: usual,
        alertNotifiedAt: same ? setting.alertNotifiedAt : null,
        updatedAt: now,
      };
      await tx
        .insert(settings)
        .values({ userId, source: run.source, ...values })
        .onConflictDoUpdate({ target: [settings.userId, settings.source], set: values });
      if (!values.alertNotifiedAt) fresh.push(run.source);
    }
    return results;
  });

  if (fresh.length > 0) {
    const texts = resources.fr.translation;
    const names = fresh.map(
      (name) => (texts.sources.names as Record<string, string>)[name] ?? name,
    );
    if (deps.notify) {
      try {
        await deps.notify(userId, {
          title: texts.notifications.silentTitle,
          body: texts.notifications.silentBody.replace('{{sources}}', names.join(', ')),
          url: '/sources',
        });
      } catch (error) {
        deps.logger.warn(
          { err: error instanceof Error ? error.message : 'unknown' },
          'silent source notification failed',
        );
      }
    }
    // Told (or no device to tell): the banner stays until the source reads again.
    await withUser(deps.db, userId, (tx) =>
      tx
        .update(settings)
        .set({ alertNotifiedAt: now })
        .where(and(eq(settings.userId, userId), inArray(settings.source, fresh))),
    );
  }
  for (const outcome of outcomes.filter((item) => item.kind !== null)) {
    deps.logger.warn(outcome, 'silent source');
  }
  return outcomes;
}
