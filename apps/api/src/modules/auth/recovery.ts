import { randomUUID } from 'node:crypto';
import { and, count, eq, type Executor, isNull, schema } from '@job4me/db';
import { generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode } from '@job4me/security';

/** Replaces every recovery code with a fresh batch; the plain codes are shown once. */
export async function regenerateRecoveryCodes(
  db: Executor,
  input: { userId: string; recoveryKey: Buffer; count: number },
): Promise<string[]> {
  const codes = Array.from({ length: input.count }, () => generateRecoveryCode());
  const batchId = randomUUID();
  await db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, input.userId));
  await db.insert(schema.recoveryCodes).values(
    codes.map((code) => ({
      userId: input.userId,
      batchId,
      codeHmac: hashRecoveryCode(input.recoveryKey, normalizeRecoveryCode(code)!),
    })),
  );
  return codes;
}

/** Uses a recovery code once; false when it is unknown or already used. */
export async function useRecoveryCode(
  db: Executor,
  input: { userId: string; recoveryKey: Buffer; code: string; now: Date },
): Promise<boolean> {
  const normalized = normalizeRecoveryCode(input.code);
  if (!normalized) return false;
  const rows = await db
    .update(schema.recoveryCodes)
    .set({ usedAt: input.now })
    .where(
      and(
        eq(schema.recoveryCodes.userId, input.userId),
        eq(schema.recoveryCodes.codeHmac, hashRecoveryCode(input.recoveryKey, normalized)),
        isNull(schema.recoveryCodes.usedAt),
      ),
    )
    .returning({ id: schema.recoveryCodes.id });
  return rows.length > 0;
}

export async function countUnusedRecoveryCodes(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.recoveryCodes)
    .where(and(eq(schema.recoveryCodes.userId, userId), isNull(schema.recoveryCodes.usedAt)));
  return row?.n ?? 0;
}
