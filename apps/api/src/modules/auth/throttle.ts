import type { Settings } from '@job4me/config';
import { and, eq, type Executor, schema, sql } from '@job4me/db';

export type Factor = 'password' | 'totp' | 'recovery';

/**
 * Progressive lockout per factor (ADR 0003): after `threshold` consecutive failures the factor
 * waits `baseDelay`, doubled on each further failure up to `maxDelay`. Never permanent, and a
 * locked password never blocks a passkey.
 */
export async function lockedForSeconds(
  db: Executor,
  userId: string,
  factor: Factor,
  now: Date,
): Promise<number | null> {
  const [row] = await db
    .select({ lockedUntil: schema.authThrottles.lockedUntil })
    .from(schema.authThrottles)
    .where(and(eq(schema.authThrottles.userId, userId), eq(schema.authThrottles.factor, factor)))
    .limit(1);
  if (!row?.lockedUntil || row.lockedUntil <= now) return null;
  return Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000);
}

export async function registerFailure(
  db: Executor,
  userId: string,
  factor: Factor,
  now: Date,
  lockout: Settings['auth']['lockout'],
): Promise<{ failures: number; lockedSeconds: number | null }> {
  const [row] = await db
    .insert(schema.authThrottles)
    .values({ userId, factor, failures: 1, lastFailureAt: now })
    .onConflictDoUpdate({
      target: [schema.authThrottles.userId, schema.authThrottles.factor],
      set: { failures: sql`${schema.authThrottles.failures} + 1`, lastFailureAt: now },
    })
    .returning({ failures: schema.authThrottles.failures });
  const failures = row!.failures;
  if (failures < lockout.threshold) return { failures, lockedSeconds: null };
  const exponent = failures - lockout.threshold;
  const lockedSeconds = Math.min(
    lockout.baseDelaySeconds * 2 ** Math.min(exponent, 20),
    lockout.maxDelaySeconds,
  );
  await db
    .update(schema.authThrottles)
    .set({ lockedUntil: new Date(now.getTime() + lockedSeconds * 1000) })
    .where(and(eq(schema.authThrottles.userId, userId), eq(schema.authThrottles.factor, factor)));
  return { failures, lockedSeconds };
}

export async function resetFailures(db: Executor, userId: string, factor: Factor) {
  await db
    .update(schema.authThrottles)
    .set({ failures: 0, lockedUntil: null })
    .where(and(eq(schema.authThrottles.userId, userId), eq(schema.authThrottles.factor, factor)));
}
