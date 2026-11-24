import type { Settings } from '@job4me/config';
import {
  asCollectError,
  cleanOffer,
  type CollectedOffer,
  CollectError,
  compileTitleFilter,
  type Connector,
  type ConnectorContext,
  type FetchLike,
  lockedByUsageMode,
  PoliteClient,
  type RawOffer,
  type Sleep,
  SourceSkipped,
  sourceSettings,
} from '@job4me/collect';
import type { CollectPassJob, PassTrigger, RunStatus, SkipReason } from '@job4me/contracts';
import { and, asc, type Database, desc, eq, inArray, lt, schema, sql, withUser } from '@job4me/db';
import type { Logger } from '@job4me/logger';
import type { PushMessage } from '../notify';
import { checkSilentSources } from './alerts';
import { storePostings } from './postings';

// The orchestrator (ADR 0013): one pass, one source at a time in calling order, each in its own
// try/catch and time budget within the pass budget. A source that fails never stops the others;
// a source deliberately not called is "skipped" with its reason, never "0 offers". Every run is
// logged with what was read, kept after the title filter, and among those the new announcements
// and the postings merged into one already there (CLAUDE.md, ADR 0016).

export interface CollectDeps {
  db: Database;
  settings: Settings;
  logger: Logger;
  /** The connectors of this machine (availableConnectors), or test ones. */
  connectors: readonly Connector[];
  /** Keys of the sources that need one (Adzuna, SerpApi): absent, the source is skipped. */
  secrets: Readonly<Record<string, string | undefined>>;
  /** Tests replace the network and the waits. */
  fetch?: FetchLike;
  sleep?: Sleep;
  now?: () => Date;
  /** Tells the account's phone of a silent source (decision D4); absent without push keys. */
  notify?: (userId: string, message: PushMessage) => Promise<unknown>;
}

export interface RunOutcome {
  source: string;
  status: RunStatus;
  skipReason: SkipReason | null;
  errorCode: CollectError['code'] | null;
  readCount: number;
  keptCount: number;
  newCount: number;
  mergedCount: number;
}

interface Profile {
  keywords: Array<{ keyword: string; priority: boolean }>;
  baseCity: string | null;
  basePostalCode: string | null;
  radiusKm: number;
  passes: (title: string) => boolean;
  settings: Map<string, typeof schema.sourceSettings.$inferSelect>;
}

/** Keywords of a source's level: the priority ones (or the first ones), one in test mode. */
export function keywordsFor(
  connector: Connector,
  keywords: Profile['keywords'],
  trigger: PassTrigger,
  prioritySize: number,
): string[] {
  if (connector.family === 'fixed_list') return [];
  const seen = new Set<string>();
  const unique = keywords.filter(({ keyword }) => {
    const key = keyword.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const priority = unique.filter((keyword) => keyword.priority);
  const level =
    connector.keywordLevel === 'full'
      ? unique
      : priority.length > 0
        ? priority
        : unique.slice(0, prioritySize);
  const list = level.map(({ keyword }) => keyword);
  return trigger === 'test' ? list.slice(0, 1) : list;
}

async function loadProfile(deps: CollectDeps, userId: string): Promise<Profile> {
  return withUser(deps.db, userId, async (tx) => {
    const keywords = await tx
      .select({ keyword: schema.searchKeywords.keyword, priority: schema.searchKeywords.priority })
      .from(schema.searchKeywords)
      .where(
        and(
          eq(schema.searchKeywords.userId, userId),
          eq(schema.searchKeywords.status, 'validated'),
        ),
      )
      .orderBy(
        desc(schema.searchKeywords.priority),
        asc(schema.searchKeywords.createdAt),
        asc(schema.searchKeywords.id),
      );
    const [profile] = await tx
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, userId));
    const rules = await tx
      .select({
        list: schema.titleFilterRules.list,
        expression: schema.titleFilterRules.expression,
      })
      .from(schema.titleFilterRules)
      .where(eq(schema.titleFilterRules.userId, userId));
    const settings = await tx
      .select()
      .from(schema.sourceSettings)
      .where(eq(schema.sourceSettings.userId, userId));
    return {
      keywords,
      baseCity: profile?.baseCity ?? null,
      basePostalCode: profile?.basePostalCode ?? null,
      radiusKm: profile?.radiusKm ?? deps.settings.profile.defaultRadiusKm,
      passes: compileTitleFilter(
        rules.filter((rule): rule is { list: 'keep' | 'reject' | 'always'; expression: string } =>
          ['keep', 'reject', 'always'].includes(rule.list),
        ),
      ),
      settings: new Map(settings.map((row) => [row.source, row])),
    };
  });
}

/** Why a source is not called this time, or null when it is. */
function skipReason(
  deps: CollectDeps,
  connector: Connector,
  profile: Profile,
  keywords: readonly string[],
  now: Date,
  remainingMs: number,
): SkipReason | null {
  const setting = profile.settings.get(connector.name);
  if (lockedByUsageMode(connector, deps.settings)) return 'commercial_mode';
  const enabled =
    setting?.enabled ?? sourceSettings(deps.settings, connector.name).enabledByDefault;
  if (!enabled) return 'disabled';
  if (setting?.cooldownUntil && setting.cooldownUntil > now) return 'cooldown';
  if (connector.secrets.some((name) => !deps.secrets[name])) return 'missing_key';
  if (connector.family === 'keywords' && keywords.length === 0) return 'no_keywords';
  if (remainingMs < 1000) return 'pass_budget';
  return null;
}

/**
 * Runs a connector until it ends or its budget does: a connector that ignores the budget stops
 * being waited for, and what it hands over afterwards is dropped.
 */
async function withinBudget(work: Promise<void>, signal: AbortSignal): Promise<void> {
  let stop = () => undefined as void;
  const ended = new Promise<never>((_resolve, reject) => {
    stop = () => reject(new CollectError('budget_exceeded'));
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
  // Whichever loses the race must not become an unhandled rejection.
  work.catch(() => undefined);
  ended.catch(() => undefined);
  try {
    await Promise.race([work, ended]);
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

/** Runs one source; whatever happens, its run is written with what it read. */
async function runSource(
  deps: CollectDeps,
  pass: { id: string; userId: string; trigger: PassTrigger },
  connector: Connector,
  profile: Profile,
  passDeadline: number,
): Promise<RunOutcome> {
  const now = deps.now?.() ?? new Date();
  const { userId } = pass;
  const runs = schema.sourceRuns;
  const config = sourceSettings(deps.settings, connector.name);
  const keywords = keywordsFor(
    connector,
    profile.keywords,
    pass.trigger,
    deps.settings.profile.keywords.priority,
  );
  const remaining = passDeadline - Date.now();
  const reason = skipReason(deps, connector, profile, keywords, now, remaining);
  const base = { userId, passId: pass.id, source: connector.name, trigger: pass.trigger };

  if (reason) {
    await withUser(deps.db, userId, (tx) =>
      tx.insert(runs).values({
        ...base,
        status: 'skipped',
        skipReason: reason,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
      }),
    );
    deps.logger.info({ source: connector.name, passId: pass.id, skipped: reason }, 'source run');
    return {
      source: connector.name,
      status: 'skipped',
      skipReason: reason,
      errorCode: null,
      readCount: 0,
      keptCount: 0,
      newCount: 0,
      mergedCount: 0,
    };
  }

  const [run] = await withUser(deps.db, userId, (tx) =>
    tx
      .insert(runs)
      .values({ ...base, status: 'running', startedAt: now })
      .returning({ id: runs.id }),
  );
  const started = Date.now();
  const signal = AbortSignal.timeout(Math.max(1, Math.min(config.budgetMs, remaining)));
  const log = deps.logger.child({ source: connector.name, passId: pass.id });
  const http = new PoliteClient({
    source: connector.name,
    hosts: connector.hosts,
    pauseMs: config.pauseMs,
    retries: config.retries,
    http: deps.settings.collect.http,
    signal,
    log,
    fetch: deps.fetch,
    sleep: deps.sleep,
  });
  const collected: RawOffer[] = [];
  const warnings: CollectError[] = [];
  let readCount = 0;
  let open = true;
  let quota: number | null = null;
  const context: ConnectorContext = {
    trigger: pass.trigger,
    keywords,
    baseCity: profile.baseCity,
    basePostalCode: profile.basePostalCode,
    radiusKm: profile.radiusKm,
    maxPages: pass.trigger === 'test' ? 1 : config.maxPages,
    http,
    secrets: Object.fromEntries(connector.secrets.map((name) => [name, deps.secrets[name]!])),
    area: deps.settings.collect.area,
    maxAgeDays: config.maxAgeDays ?? null,
    params: config.params ?? {},
    now,
    timeZone: deps.settings.collect.schedule.timeZone,
    signal,
    log,
    add(offers, read) {
      if (!open) return;
      collected.push(...offers);
      readCount += read ?? offers.length;
    },
    warn(error) {
      if (open) warnings.push(error);
    },
    reportQuota(remaining) {
      quota = remaining;
    },
  };

  let failure: CollectError | null = null;
  let skipped: SkipReason | null = null;
  try {
    await withinBudget(connector.run(context), signal);
  } catch (error) {
    if (error instanceof SourceSkipped) skipped = error.reason;
    else {
      failure =
        error instanceof CollectError || !signal.aborted
          ? asCollectError(error)
          : new CollectError('budget_exceeded');
    }
  } finally {
    open = false;
  }
  if (quota !== null) await storeQuota(deps, userId, connector.name, quota);
  if (skipped !== null) {
    // Found by the connector before its first search (a quota under its reserve).
    const at = deps.now?.() ?? new Date();
    await withUser(deps.db, userId, (tx) =>
      tx
        .update(runs)
        .set({
          status: 'skipped',
          skipReason: skipped,
          requestCount: http.requestCount,
          durationMs: Date.now() - started,
          finishedAt: at,
          updatedAt: at,
        })
        .where(and(eq(runs.id, run!.id), eq(runs.userId, userId))),
    );
    log.info({ skipped, requests: http.requestCount }, 'source run');
    return {
      source: connector.name,
      status: 'skipped',
      skipReason: skipped,
      errorCode: null,
      readCount: 0,
      keptCount: 0,
      newCount: 0,
      mergedCount: 0,
    };
  }

  // Common format, exact duplicates of the source merged, then the title filter.
  const maxDescription = deps.settings.collect.offers.maxDescriptionChars;
  const unique = new Map<string, CollectedOffer>();
  let invalidCount = 0;
  for (const raw of collected) {
    const offer = cleanOffer(raw, connector.name, maxDescription);
    if (!offer) invalidCount += 1;
    else if (!unique.has(offer.externalId)) unique.set(offer.externalId, offer);
  }
  const kept = [...unique.values()].filter(
    (offer) => !connector.titleFilter || profile.passes(offer.title),
  );

  const finishedAt = deps.now?.() ?? new Date();
  const { newCount, mergedCount } = await withUser(deps.db, userId, (tx) =>
    storePostings(
      tx,
      {
        userId,
        source: connector.name,
        trigger: pass.trigger,
        at: finishedAt,
        settings: deps.settings,
        sourceOrder: deps.connectors.map((item) => item.name),
      },
      kept,
    ),
  );

  const problem = failure ?? warnings[0] ?? null;
  const status: RunStatus =
    failure === null
      ? warnings.length > 0
        ? 'partial'
        : 'succeeded'
      : readCount > 0 || collected.length > 0
        ? 'partial'
        : 'failed';
  const result = {
    status,
    errorCode: problem?.code ?? null,
    httpStatus: problem?.httpStatus ?? null,
    readCount,
    keptCount: kept.length,
    newCount,
    mergedCount,
    invalidCount,
    requestCount: http.requestCount,
    durationMs: Date.now() - started,
    finishedAt,
    updatedAt: finishedAt,
  };
  await withUser(deps.db, userId, async (tx) => {
    await tx
      .update(runs)
      .set(result)
      .where(and(eq(runs.id, run!.id), eq(runs.userId, userId)));
    // A 403 or a 429 also stops the next passes for a while when the source asks for it.
    if (failure?.code === 'blocked' && config.cooldownHoursAfterBlock > 0) {
      const until = new Date(finishedAt.getTime() + config.cooldownHoursAfterBlock * 3_600_000);
      await tx
        .insert(schema.sourceSettings)
        .values({ userId, source: connector.name, cooldownUntil: until })
        .onConflictDoUpdate({
          target: [schema.sourceSettings.userId, schema.sourceSettings.source],
          set: { cooldownUntil: until, updatedAt: finishedAt },
        });
    }
  });
  log.info(
    {
      status,
      read: readCount,
      kept: kept.length,
      new: newCount,
      merged: mergedCount,
      invalid: invalidCount,
      requests: http.requestCount,
      ms: result.durationMs,
      error: result.errorCode,
      httpStatus: result.httpStatus,
    },
    'source run',
  );
  return {
    source: connector.name,
    status,
    skipReason: null,
    errorCode: result.errorCode,
    readCount,
    keptCount: kept.length,
    newCount,
    mergedCount,
  };
}

/** The searches left on a rationed source, as its account told just now. */
async function storeQuota(deps: CollectDeps, userId: string, source: string, remaining: number) {
  const at = deps.now?.() ?? new Date();
  const settings = schema.sourceSettings;
  await withUser(deps.db, userId, (tx) =>
    tx
      .insert(settings)
      .values({ userId, source, quotaRemaining: remaining, quotaCheckedAt: at })
      .onConflictDoUpdate({
        target: [settings.userId, settings.source],
        set: { quotaRemaining: remaining, quotaCheckedAt: at, updatedAt: at },
      }),
  );
}

/** Passes left running by a worker that stopped are closed, with their running sources. */
export async function closeStalePasses(deps: CollectDeps, userId: string, keep?: string) {
  const now = deps.now?.() ?? new Date();
  const before = new Date(now.getTime() - deps.settings.collect.staleAfterMs);
  const passes = schema.collectionPasses;
  await withUser(deps.db, userId, async (tx) => {
    const stale = await tx
      .update(passes)
      .set({ status: 'interrupted', finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(passes.userId, userId),
          inArray(passes.status, ['queued', 'running']),
          lt(passes.createdAt, before),
          keep ? sql`${passes.id} <> ${keep}` : undefined,
        ),
      )
      .returning({ id: passes.id });
    if (stale.length === 0) return;
    await tx
      .update(schema.sourceRuns)
      .set({ status: 'failed', errorCode: 'interrupted', finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.sourceRuns.userId, userId),
          eq(schema.sourceRuns.status, 'running'),
          inArray(
            schema.sourceRuns.passId,
            stale.map((pass) => pass.id),
          ),
        ),
      );
  });
}

/** Runs one pass. A pass that is not waiting any more (already run, interrupted) is left alone. */
export async function runPass(deps: CollectDeps, job: CollectPassJob): Promise<RunOutcome[]> {
  const { userId, passId } = job;
  const passes = schema.collectionPasses;
  await closeStalePasses(deps, userId, passId);
  const startedAt = deps.now?.() ?? new Date();
  const [pass] = await withUser(deps.db, userId, (tx) =>
    tx
      .update(passes)
      .set({ status: 'running', startedAt, updatedAt: startedAt })
      .where(and(eq(passes.id, passId), eq(passes.userId, userId), eq(passes.status, 'queued')))
      .returning(),
  );
  if (!pass) {
    deps.logger.warn({ passId }, 'collection pass not waiting: skipped');
    return [];
  }
  const trigger = pass.trigger as PassTrigger;
  const passDeadline = Date.now() + deps.settings.collect.passBudgetMs;
  const outcomes: RunOutcome[] = [];
  let completed = false;
  try {
    const profile = await loadProfile(deps, userId);
    // Calling order is the connectors' order, whatever the order of the request.
    for (const connector of deps.connectors.filter((item) => pass.sources.includes(item.name))) {
      const target = { id: pass.id, userId, trigger };
      try {
        outcomes.push(await runSource(deps, target, connector, profile, passDeadline));
      } catch (error) {
        // Not the source's fault (its own errors are caught inside): the database refused to
        // record it. The run is closed as failed and the next source still runs.
        deps.logger.error(
          {
            passId,
            source: connector.name,
            err: error instanceof Error ? error.message : 'unknown',
          },
          'source run not recorded',
        );
        await withUser(deps.db, userId, (tx) =>
          tx
            .update(schema.sourceRuns)
            .set({ status: 'failed', errorCode: 'connector_error', updatedAt: new Date() })
            .where(
              and(
                eq(schema.sourceRuns.userId, userId),
                eq(schema.sourceRuns.passId, passId),
                eq(schema.sourceRuns.source, connector.name),
                eq(schema.sourceRuns.status, 'running'),
              ),
            ),
        ).catch(() => undefined);
      }
    }
    completed = true;
  } finally {
    // An error of the orchestrator itself (the database gone) ends the pass as interrupted.
    const finishedAt = deps.now?.() ?? new Date();
    await withUser(deps.db, userId, async (tx) => {
      await tx
        .update(passes)
        .set({ status: completed ? 'done' : 'interrupted', finishedAt, updatedAt: finishedAt })
        .where(and(eq(passes.id, passId), eq(passes.userId, userId)));
      if (!completed) {
        await tx
          .update(schema.sourceRuns)
          .set({ status: 'failed', errorCode: 'interrupted', finishedAt, updatedAt: finishedAt })
          .where(
            and(
              eq(schema.sourceRuns.userId, userId),
              eq(schema.sourceRuns.passId, passId),
              eq(schema.sourceRuns.status, 'running'),
            ),
          );
      }
    }).catch((error: unknown) =>
      deps.logger.error(
        { passId, err: error instanceof Error ? error.message : 'unknown' },
        'collection pass not closed',
      ),
    );
  }
  // Silent sources (decision D4): judged on scheduled and manual passes, never on tests.
  if (completed && trigger !== 'test') {
    await checkSilentSources(deps, userId, passId).catch((error: unknown) =>
      deps.logger.error(
        { passId, err: error instanceof Error ? error.message : 'unknown' },
        'silent sources not checked',
      ),
    );
  }
  const totals = outcomes.reduce(
    (sum, outcome) => ({
      read: sum.read + outcome.readCount,
      kept: sum.kept + outcome.keptCount,
      new: sum.new + outcome.newCount,
      merged: sum.merged + outcome.mergedCount,
    }),
    { read: 0, kept: 0, new: 0, merged: 0 },
  );
  deps.logger.info(
    { passId, trigger, sources: outcomes.length, ...totals },
    'collection pass done',
  );
  return outcomes;
}
