import { randomBytes } from 'node:crypto';
import type { Settings } from '@job4me/config';
import { and, eq, type Executor, isNull, schema, sql } from '@job4me/db';
import {
  checkPasswordStrength,
  hashPassword,
  type PasswordProblem,
  randomToken,
  sha256,
} from '@job4me/security';
import { addMs } from './clock';

export class PasswordTooWeakError extends Error {
  override name = 'PasswordTooWeakError';
  constructor(readonly problem: PasswordProblem) {
    super(`password rejected: ${problem}`);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findUserByEmail(db: Executor, email: string) {
  return db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${normalizeEmail(email)}`)
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

export function findUserById(db: Executor, id: string) {
  return db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

/** Validates then hashes a new password (length first, then obvious patterns). */
export async function preparePassword(password: string, settings: Settings): Promise<string> {
  const problem = checkPasswordStrength(password, settings.auth.password);
  if (problem) throw new PasswordTooWeakError(problem);
  return hashPassword(password, settings.auth.password.argon2);
}

/** Creates the account from the command line: there is no public sign-up (SPEC section 2). */
export async function createUser(
  db: Executor,
  input: { email: string; displayName: string; password: string; settings: Settings },
) {
  const passwordHash = await preparePassword(input.password, input.settings);
  const [user] = await db
    .insert(schema.users)
    .values({
      email: normalizeEmail(input.email),
      displayName: input.displayName.trim(),
      webauthnUserHandle: randomBytes(32),
      passwordHash,
    })
    .returning();
  return user!;
}

/**
 * Issues a one-time enrollment link token; older unused links of this user stop working.
 * Only the SHA-256 of the token is stored.
 */
export async function issueEnrollmentToken(
  db: Executor,
  input: { userId: string; now: Date; validityMs: number },
): Promise<{ token: string; expiresAt: Date }> {
  await db
    .update(schema.oneTimeTokens)
    .set({ consumedAt: input.now })
    .where(
      and(
        eq(schema.oneTimeTokens.userId, input.userId),
        eq(schema.oneTimeTokens.purpose, 'enrollment'),
        isNull(schema.oneTimeTokens.consumedAt),
      ),
    );
  const token = randomToken();
  const expiresAt = addMs(input.now, input.validityMs);
  await db.insert(schema.oneTimeTokens).values({
    userId: input.userId,
    purpose: 'enrollment',
    tokenHash: sha256(token),
    expiresAt,
  });
  return { token, expiresAt };
}

/** Finds the live enrollment token, without consuming it. */
export async function findEnrollmentToken(db: Executor, token: string, now: Date) {
  const [row] = await db
    .select({ id: schema.oneTimeTokens.id, userId: schema.oneTimeTokens.userId })
    .from(schema.oneTimeTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.oneTimeTokens.userId))
    .where(
      and(
        eq(schema.oneTimeTokens.tokenHash, sha256(token)),
        eq(schema.oneTimeTokens.purpose, 'enrollment'),
        isNull(schema.oneTimeTokens.consumedAt),
        sql`${schema.oneTimeTokens.expiresAt} > ${now}`,
        eq(schema.users.status, 'active'),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function consumeEnrollmentToken(db: Executor, id: string, now: Date) {
  const rows = await db
    .update(schema.oneTimeTokens)
    .set({ consumedAt: now })
    .where(and(eq(schema.oneTimeTokens.id, id), isNull(schema.oneTimeTokens.consumedAt)))
    .returning({ id: schema.oneTimeTokens.id });
  return rows.length > 0;
}

export function enrollmentLink(publicOrigin: string, token: string): string {
  // The token travels in the fragment: never sent to a server nor written in access logs.
  return `${publicOrigin}/enroll#t=${token}`;
}
