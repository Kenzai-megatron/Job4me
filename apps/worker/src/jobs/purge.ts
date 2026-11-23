import type { Settings } from '@job4me/config';
import { and, type Database, eq, isNotNull, lt, ne, or, schema, withUser } from '@job4me/db';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hourly housekeeping: expired challenges, used or expired enrollment links, and sessions
 * closed for longer than the configured retention. The audit log is never purged.
 */
export async function purgeExpired(db: Database, settings: Settings, now: Date = new Date()) {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const tokenCutoff = new Date(now.getTime() - settings.worker.consumedTokenRetentionDays * DAY_MS);
  const sessionCutoff = new Date(
    now.getTime() - settings.worker.expiredSessionRetentionDays * DAY_MS,
  );

  const challenges = await db
    .delete(schema.authChallenges)
    .where(lt(schema.authChallenges.expiresAt, dayAgo))
    .returning({ id: schema.authChallenges.id });

  const tokens = await db
    .delete(schema.oneTimeTokens)
    .where(
      and(
        lt(schema.oneTimeTokens.createdAt, tokenCutoff),
        or(isNotNull(schema.oneTimeTokens.consumedAt), lt(schema.oneTimeTokens.expiresAt, now)),
      ),
    )
    .returning({ id: schema.oneTimeTokens.id });

  const sessions = await db
    .delete(schema.sessions)
    .where(
      and(
        lt(schema.sessions.lastSeenAt, sessionCutoff),
        or(
          isNotNull(schema.sessions.revokedAt),
          lt(schema.sessions.idleExpiresAt, now),
          lt(schema.sessions.absoluteExpiresAt, now),
        ),
      ),
    )
    .returning({ id: schema.sessions.id });

  return { challenges: challenges.length, tokens: tokens.length, sessions: sessions.length };
}

/**
 * Imports reviewed (or failed) longer ago than the retention of the configuration: their
 * extracted text and their decided proposals are erased (ADR 0010). What Mehdi accepted lives on
 * in the profile; the encrypted file stays until the import is deleted.
 */
export async function purgeImports(db: Database, settings: Settings, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - settings.imports.extractedRetentionDays * DAY_MS);
  const done = await db
    .select({ id: schema.importRunsDone.id, userId: schema.importRunsDone.userId })
    .from(schema.importRunsDone)
    .where(lt(schema.importRunsDone.updatedAt, cutoff));
  for (const run of done) {
    await withUser(db, run.userId, async (tx) => {
      await tx
        .delete(schema.importProposals)
        .where(
          and(
            eq(schema.importProposals.importRunId, run.id),
            eq(schema.importProposals.userId, run.userId),
            ne(schema.importProposals.decision, 'pending'),
          ),
        );
      await tx
        .update(schema.importRuns)
        .set({ extracted: null, updatedAt: now })
        .where(and(eq(schema.importRuns.id, run.id), eq(schema.importRuns.userId, run.userId)));
    });
  }
  return { imports: done.length };
}
