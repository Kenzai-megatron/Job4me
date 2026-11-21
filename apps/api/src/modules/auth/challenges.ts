import { and, desc, eq, type Executor, gt, isNull, schema } from '@job4me/db';
import { sha256 } from '@job4me/security';

export type ChallengePurpose = 'registration' | 'authentication' | 'reauth' | 'password_verified';

/** Challenges are bound to the browser that asked for them (pre-login cookie or session). */
export function bindingHash(binding: string): Buffer {
  return sha256(`binding:${binding}`);
}

export async function storeChallenge(
  db: Executor,
  input: {
    purpose: ChallengePurpose;
    challenge: string | null;
    binding: string;
    userId: string | null;
    expiresAt: Date;
  },
): Promise<void> {
  await db.insert(schema.authChallenges).values({
    purpose: input.purpose,
    challenge: input.challenge,
    bindingHash: bindingHash(input.binding),
    userId: input.userId,
    expiresAt: input.expiresAt,
  });
}

interface ChallengeQuery {
  purpose: ChallengePurpose;
  binding: string;
  now: Date;
  userId?: string;
}

/** The latest live challenge of this purpose for this browser, left unconsumed. */
export async function peekChallenge(db: Executor, input: ChallengeQuery) {
  const conditions = [
    eq(schema.authChallenges.bindingHash, bindingHash(input.binding)),
    eq(schema.authChallenges.purpose, input.purpose),
    isNull(schema.authChallenges.consumedAt),
    gt(schema.authChallenges.expiresAt, input.now),
  ];
  if (input.userId) conditions.push(eq(schema.authChallenges.userId, input.userId));
  const [candidate] = await db
    .select({
      id: schema.authChallenges.id,
      challenge: schema.authChallenges.challenge,
      userId: schema.authChallenges.userId,
    })
    .from(schema.authChallenges)
    .where(and(...conditions))
    .orderBy(desc(schema.authChallenges.createdAt))
    .limit(1);
  return candidate ?? null;
}

/** Marks one challenge as used; false when another request already used it. */
export async function consumeChallengeById(db: Executor, id: string, now: Date) {
  const rows = await db
    .update(schema.authChallenges)
    .set({ consumedAt: now })
    .where(and(eq(schema.authChallenges.id, id), isNull(schema.authChallenges.consumedAt)))
    .returning({ id: schema.authChallenges.id });
  return rows.length > 0;
}

/**
 * Takes the latest live challenge of this purpose for this browser, exactly once:
 * a second request with the same challenge finds nothing (replay protection).
 */
export async function consumeChallenge(db: Executor, input: ChallengeQuery) {
  const candidate = await peekChallenge(db, input);
  if (!candidate) return null;
  return (await consumeChallengeById(db, candidate.id, input.now)) ? candidate : null;
}
