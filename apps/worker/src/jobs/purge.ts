import type { Settings } from '@job4me/config';
import { and, type Database, isNotNull, lt, or, schema } from '@job4me/db';

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
