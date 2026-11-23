import type { Settings } from '@job4me/config';
import {
  type CollectionPass,
  passSchema,
  type PassTrigger,
  QUEUES,
  type SourceRun,
  sourceRunSchema,
} from '@job4me/contracts';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  recordAudit,
  schema,
  type SourceRunRow,
  type Transaction,
} from '@job4me/db';
import type { Connector } from '@job4me/collect';
import type { JobQueue } from '../../context';
import { HttpError } from '../../errors';

// Collection passes from the API and the command line (plan, section 8): they are queued for the
// worker, which alone talks to the sources. The API never calls a source.

type PassRow = typeof schema.collectionPasses.$inferSelect;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export function toSourceRun(row: SourceRunRow): SourceRun {
  return sourceRunSchema.parse({
    id: row.id,
    passId: row.passId,
    source: row.source,
    trigger: row.trigger,
    status: row.status,
    skipReason: row.skipReason,
    errorCode: row.errorCode,
    httpStatus: row.httpStatus,
    readCount: row.readCount,
    keptCount: row.keptCount,
    newCount: row.newCount,
    invalidCount: row.invalidCount,
    requestCount: row.requestCount,
    durationMs: row.durationMs,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
  });
}

export function toPass(row: PassRow, runs: SourceRunRow[]): CollectionPass {
  return passSchema.parse({
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    sources: row.sources,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    runs: runs.map(toSourceRun),
  });
}

/** A pass with its runs, in the order they ran. */
export async function loadPass(tx: Transaction, userId: string, passId: string) {
  const [row] = await tx
    .select()
    .from(schema.collectionPasses)
    .where(and(eq(schema.collectionPasses.id, passId), eq(schema.collectionPasses.userId, userId)));
  if (!row) return null;
  const runs = await tx
    .select()
    .from(schema.sourceRuns)
    .where(and(eq(schema.sourceRuns.passId, passId), eq(schema.sourceRuns.userId, userId)))
    .orderBy(schema.sourceRuns.createdAt);
  return toPass(row, runs);
}

/** The sources asked for, known on this machine, in calling order; all of them by default. */
export function plannedSources(
  connectors: readonly Connector[],
  asked?: readonly string[],
): string[] {
  const names = connectors.map((connector) => connector.name);
  if (!asked) return names;
  if (asked.some((name) => !names.includes(name))) throw new HttpError(400, 'source_unknown');
  return names.filter((name) => asked.includes(name));
}

export interface CreatePassInput {
  userId: string;
  trigger: Exclude<PassTrigger, 'scheduled'>;
  sources: string[];
  actor: 'user' | 'cli';
  requestId?: string;
}

/**
 * Queues a manual or test pass. A test pass already waiting or running (and not stale) is
 * returned instead of a second one: one test at a time.
 */
export async function createPass(
  tx: Transaction,
  settings: Settings,
  input: CreatePassInput,
): Promise<{ pass: CollectionPass; created: boolean }> {
  const passes = schema.collectionPasses;
  if (input.sources.length === 0) throw new HttpError(400, 'source_unknown');
  if (input.trigger === 'test') {
    const [pending] = await tx
      .select()
      .from(passes)
      .where(
        and(
          eq(passes.userId, input.userId),
          eq(passes.trigger, 'test'),
          inArray(passes.status, ['queued', 'running']),
          gte(passes.createdAt, new Date(Date.now() - settings.collect.staleAfterMs)),
        ),
      )
      .orderBy(desc(passes.createdAt))
      .limit(1);
    if (pending) {
      return { pass: (await loadPass(tx, input.userId, pending.id))!, created: false };
    }
  }
  const [row] = await tx
    .insert(passes)
    .values({ userId: input.userId, trigger: input.trigger, sources: input.sources })
    .returning();
  await recordAudit(tx, {
    actorType: input.actor,
    actorUserId: input.userId,
    action: input.trigger === 'test' ? 'sources.test_requested' : 'sources.pass_requested',
    outcome: 'success',
    targetType: 'collection_pass',
    targetId: row!.id,
    requestId: input.requestId,
    metadata: { sources: input.sources.join(',') },
  });
  return { pass: toPass(row!, []), created: true };
}

export async function queuePass(queue: JobQueue, userId: string, passId: string): Promise<void> {
  await queue.send(QUEUES.collectPass, { userId, passId });
}
