import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Purposes for keys derived from the master key (ADR 0004). */
export type KeyPurpose = 'totp' | 'recovery' | 'csrf' | 'mail-token' | 'files' | 'identity';

const FORMAT_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class CryptoError extends Error {
  override name = 'CryptoError';
}

/** Decodes a base64 key and checks it holds 32 bytes. */
export function parseKey(base64: string, name = 'key'): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) {
    throw new CryptoError(`the ${name} must be 32 random bytes encoded in base64`);
  }
  return key;
}

/** Decodes the base64 master key and checks it holds 32 bytes. */
export function parseMasterKey(base64: string): Buffer {
  return parseKey(base64, 'master key');
}

/** Derives a 32-byte key for one purpose with HKDF-SHA-256. */
export function deriveKey(masterKey: Buffer, purpose: KeyPurpose, version = 1): Buffer {
  return Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.alloc(0), `job4me:${purpose}:v${version}`, 32),
  );
}

/** Associated data that binds a ciphertext to one column of one row. */
export function aadFor(table: string, column: string, rowId: string): string {
  return `${table}:${column}:${rowId}`;
}

/** AES-256-GCM: version (1 byte) | nonce (12) | ciphertext | tag (16). */
export function encrypt(key: Buffer, plaintext: Buffer | string, aad: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), nonce, ciphertext, cipher.getAuthTag()]);
}

export function decrypt(key: Buffer, blob: Buffer, aad: string): Buffer {
  if (blob.length < 1 + NONCE_BYTES + TAG_BYTES || blob[0] !== FORMAT_VERSION) {
    throw new CryptoError('unknown ciphertext format');
  }
  const nonce = blob.subarray(1, 1 + NONCE_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(1 + NONCE_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new CryptoError('decryption failed');
  }
}

/** Random token encoded in base64url (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: Buffer | string): Buffer {
  return createHash('sha256').update(input).digest();
}

export function hmacSha256(key: Buffer, input: Buffer | string): Buffer {
  return createHmac('sha256', key).update(input).digest();
}

/** Constant-time comparison that also accepts buffers of different lengths. */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** CSRF token bound to a session or to the pre-login cookie (ADR 0003). */
export function csrfToken(csrfKey: Buffer, binding: string): string {
  return hmacSha256(csrfKey, `csrf:${binding}`).toString('base64url');
}

export function verifyCsrfToken(csrfKey: Buffer, binding: string, token: string): boolean {
  const expected = Buffer.from(csrfToken(csrfKey, binding), 'utf8');
  return safeEqual(expected, Buffer.from(token, 'utf8'));
}
