import { readFile } from 'node:fs/promises';
import type { ImportKind } from '@job4me/contracts';
import { and, type Database, eq, schema, sql } from '@job4me/db';
import { extractedAad, storagePath, uploadAad } from '@job4me/imports/extract';
import type { Logger } from '@job4me/logger';
import { decrypt, encrypt } from '@job4me/security';
import type { Outcome, Runner } from './runner';

// The extractor (ADR 0010) works with the job4me_extractor role: it can read a few columns of
// upload and import_run, and move a run from queued or extracting to extracted or failed.

export interface ExtractorDeps {
  db: Database;
  /** Import key: decrypts the uploaded file, encrypts what was read from it. */
  key: Buffer;
  filesDir: string;
  logger: Logger;
  runner: Runner;
  maxAttempts: number;
  staleAfterMs: number;
}

type Claimed = {
  id: string;
  upload_id: string;
  attempts: number;
};

/** Takes the oldest queued run, or one whose extraction stalled; other extractors skip it. */
export async function claimNext(db: Database, staleAfterMs: number): Promise<Claimed | null> {
  const result = await db.execute<Claimed>(sql`
    update import_run
    set status = 'extracting', attempts = attempts + 1, claimed_at = now(), updated_at = now()
    where id = (
      select id from import_run
      where status = 'queued'
        or (status = 'extracting'
          and claimed_at < now() - make_interval(secs => ${staleAfterMs / 1000}::double precision))
      order by created_at
      limit 1
      for update skip locked
    )
    returning id, upload_id, attempts`);
  return result.rows[0] ?? null;
}

async function finish(db: Database, key: Buffer, id: string, outcome: Outcome): Promise<void> {
  const extracting = and(eq(schema.importRuns.id, id), eq(schema.importRuns.status, 'extracting'));
  if (outcome.ok) {
    await db
      .update(schema.importRuns)
      .set({
        status: 'extracted',
        errorCode: null,
        extracted: encrypt(key, JSON.stringify(outcome.document), extractedAad(id)),
        stats: outcome.stats,
        extractedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(extracting);
    return;
  }
  await db
    .update(schema.importRuns)
    .set({ status: 'failed', errorCode: outcome.code, updatedAt: new Date() })
    .where(extracting);
}

/** Extracts one waiting file; false when there was nothing to do. */
export async function processNext(deps: ExtractorDeps): Promise<boolean> {
  const claimed = await claimNext(deps.db, deps.staleAfterMs);
  if (!claimed) return false;
  const log = deps.logger.child({ importRunId: claimed.id });
  if (claimed.attempts > deps.maxAttempts) {
    // The file stopped the extractor every time: give up instead of trying forever.
    await finish(deps.db, deps.key, claimed.id, { ok: false, code: 'extraction_failed' });
    log.warn({ attempts: claimed.attempts - 1 }, 'extraction given up');
    return true;
  }

  const started = Date.now();
  let outcome: Outcome;
  try {
    const [upload] = await deps.db
      .select({ kind: schema.uploads.kind, storageKey: schema.uploads.storageKey })
      .from(schema.uploads)
      .where(eq(schema.uploads.id, claimed.upload_id));
    if (!upload) throw new Error('upload not found');
    const blob = await readFile(storagePath(deps.filesDir, upload.storageKey));
    const bytes = decrypt(deps.key, blob, uploadAad(claimed.upload_id));
    outcome = await deps.runner(upload.kind as ImportKind, bytes);
  } catch (error) {
    // No content in the log: only the kind of failure (missing file, wrong key...).
    log.error(
      { err: error instanceof Error ? error.message : 'unknown' },
      'extraction could not run',
    );
    outcome = { ok: false, code: 'extraction_failed' };
  }
  await finish(deps.db, deps.key, claimed.id, outcome);
  log.info(
    {
      outcome: outcome.ok ? 'extracted' : outcome.code,
      ...(!outcome.ok && outcome.reason ? { reason: outcome.reason } : {}),
      durationMs: Date.now() - started,
      ...(outcome.ok ? { stats: outcome.stats } : {}),
    },
    'extraction finished',
  );
  return true;
}

/** Polls for waiting files until stopped; one file at a time. */
export function startExtractor(deps: ExtractorDeps, pollIntervalMs: number) {
  let stopped = false;
  let wake: (() => void) | undefined;
  const pause = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, pollIntervalMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  const loop = (async () => {
    while (!stopped) {
      let worked = false;
      try {
        worked = await processNext(deps);
      } catch (error) {
        deps.logger.error({ err: error }, 'extractor cannot reach the database');
      }
      if (!worked && !stopped) await pause();
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
