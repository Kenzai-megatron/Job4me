import { randomBytes } from 'node:crypto';
import { hmacSha256 } from './crypto';

// Crockford base32: no I, L, O or U, so codes are easy to read and type.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_LENGTH = 16;

/** One recovery code, 16 characters (80 bits) shown as XXXX-XXXX-XXXX-XXXX. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += ALPHABET[byte & 31];
  return code.match(/.{4}/g)!.join('-');
}

/** Normalizes what a person typed; returns null when it cannot be a recovery code. */
export function normalizeRecoveryCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replaceAll(/[\s-]/g, '')
    .replaceAll('O', '0')
    .replaceAll(/[IL]/g, '1');
  if (cleaned.length !== RECOVERY_CODE_LENGTH) return null;
  for (const char of cleaned) if (!ALPHABET.includes(char)) return null;
  return cleaned;
}

/** Stored form of a recovery code: HMAC with the derived recovery key (ADR 0004). */
export function hashRecoveryCode(recoveryKey: Buffer, normalizedCode: string): Buffer {
  return hmacSha256(recoveryKey, `recovery:${normalizedCode}`);
}
