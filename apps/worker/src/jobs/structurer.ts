import { and, eq, lt, or, schema, withUser } from '@job4me/db';
import { type StructureDeps, structureImport } from './structure-import';

// Finds the CV imports the extractor has read, across accounts, through the import_run_ready
// view (identifiers only), then structures each one under row-level security for its account.

export async function structurePending(deps: StructureDeps): Promise<number> {
  const ready = schema.importRunsReady;
  const staleBefore = new Date(Date.now() - deps.settings.ai.structuring.staleAfterMs);
  const runs = await deps.db
    .select({ id: ready.id, userId: ready.userId })
    .from(ready)
    .where(or(eq(ready.status, 'extracted'), lt(ready.updatedAt, staleBefore)))
    .orderBy(ready.updatedAt)
    .limit(10);
  let done = 0;
  for (const run of runs) {
    try {
      if (await structureImport(deps, run)) done += 1;
    } catch (error) {
      deps.logger.error(
        { importRunId: run.id, err: error instanceof Error ? error.message : 'unknown' },
        'structuring failed',
      );
      // An import that breaks the structuring is given up, not retried every few minutes.
      const runs = schema.importRuns;
      await withUser(deps.db, run.userId, (tx) =>
        tx
          .update(runs)
          .set({ status: 'failed', errorCode: 'ai_failed', updatedAt: new Date() })
          .where(and(eq(runs.id, run.id), eq(runs.status, 'structuring'))),
      ).catch(() => undefined);
    }
  }
  return done;
}

/** Polls for extracted CVs until stopped. */
export function startStructurer(deps: StructureDeps) {
  let stopped = false;
  let wake: (() => void) | undefined;
  const loop = (async () => {
    while (!stopped) {
      try {
        await structurePending(deps);
      } catch (error) {
        deps.logger.error({ err: error }, 'structurer cannot reach the database');
      }
      if (stopped) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, deps.settings.ai.structuring.pollIntervalMs);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  })();
  return {
    stop: async () => {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}
