import { and, eq, type Executor, isNull, lt, or, schema } from '@job4me/db';
import {
  aadFor,
  decrypt,
  encrypt,
  generateTotpSecret,
  totpUri,
  verifyTotp,
} from '@job4me/security';

const TABLE = 'totp_secret';

function aad(column: 'secret_ciphertext' | 'pending_secret_ciphertext', userId: string) {
  return aadFor(TABLE, column, userId);
}

async function row(db: Executor, userId: string) {
  const [found] = await db
    .select()
    .from(schema.totpSecrets)
    .where(eq(schema.totpSecrets.userId, userId))
    .limit(1);
  return found ?? null;
}

export async function isTotpEnabled(db: Executor, userId: string): Promise<boolean> {
  const found = await row(db, userId);
  return Boolean(found?.secretCiphertext && found.confirmedAt);
}

/**
 * Prepares a new secret, encrypted (ADR 0004). An active secret keeps working until the new one
 * is confirmed, so an abandoned reset never locks the user out.
 */
export async function startTotpSetup(
  db: Executor,
  input: { userId: string; totpKey: Buffer; issuer: string; label: string; now: Date },
) {
  const secret = generateTotpSecret();
  const pending = encrypt(input.totpKey, secret, aad('pending_secret_ciphertext', input.userId));
  await db
    .insert(schema.totpSecrets)
    .values({
      userId: input.userId,
      pendingSecretCiphertext: pending,
      pendingCreatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: schema.totpSecrets.userId,
      set: { pendingSecretCiphertext: pending, pendingCreatedAt: input.now },
    });
  return { secret, uri: totpUri(secret, input.issuer, input.label) };
}

/** Confirms the pending secret with a valid code, which makes it the active one. */
export async function confirmTotpSetup(
  db: Executor,
  input: { userId: string; totpKey: Buffer; code: string; window: number; now: Date },
): Promise<boolean> {
  const found = await row(db, input.userId);
  if (!found?.pendingSecretCiphertext) return false;
  const secret = decrypt(
    input.totpKey,
    found.pendingSecretCiphertext,
    aad('pending_secret_ciphertext', input.userId),
  ).toString('utf8');
  const step = verifyTotp({
    secretBase32: secret,
    code: input.code,
    window: input.window,
    lastUsedStep: null,
    timestamp: input.now.getTime(),
  });
  if (step === null) return false;
  await db
    .update(schema.totpSecrets)
    .set({
      secretCiphertext: encrypt(input.totpKey, secret, aad('secret_ciphertext', input.userId)),
      confirmedAt: input.now,
      lastUsedStep: step,
      pendingSecretCiphertext: null,
      pendingCreatedAt: null,
    })
    .where(eq(schema.totpSecrets.userId, input.userId));
  return true;
}

/** Checks a code against the active secret and records its step, once (replay protection). */
export async function useTotpCode(
  db: Executor,
  input: { userId: string; totpKey: Buffer; code: string; window: number; now: Date },
): Promise<boolean> {
  const found = await row(db, input.userId);
  if (!found?.secretCiphertext || !found.confirmedAt) return false;
  const secret = decrypt(
    input.totpKey,
    found.secretCiphertext,
    aad('secret_ciphertext', input.userId),
  ).toString('utf8');
  const step = verifyTotp({
    secretBase32: secret,
    code: input.code,
    window: input.window,
    lastUsedStep: found.lastUsedStep,
    timestamp: input.now.getTime(),
  });
  if (step === null) return false;
  // Conditional update: two requests racing with the same code cannot both succeed.
  const updated = await db
    .update(schema.totpSecrets)
    .set({ lastUsedStep: step })
    .where(
      and(
        eq(schema.totpSecrets.userId, input.userId),
        or(isNull(schema.totpSecrets.lastUsedStep), lt(schema.totpSecrets.lastUsedStep, step)),
      ),
    )
    .returning({ userId: schema.totpSecrets.userId });
  return updated.length > 0;
}
