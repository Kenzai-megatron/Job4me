import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  aadFor,
  checkPasswordStrength,
  csrfToken,
  decrypt,
  deriveKey,
  encrypt,
  generateRecoveryCode,
  generateTotpCode,
  generateTotpSecret,
  hashPassword,
  hashRecoveryCode,
  needsRehash,
  normalizeRecoveryCode,
  parseMasterKey,
  totpUri,
  verifyCsrfToken,
  verifyPassword,
  verifyTotp,
} from './index';

const master = randomBytes(32);

describe('master key and derivation', () => {
  it('accepts 32 bytes in base64 and rejects anything else', () => {
    expect(parseMasterKey(master.toString('base64'))).toHaveLength(32);
    expect(() => parseMasterKey(randomBytes(16).toString('base64'))).toThrow();
  });

  it('derives distinct, stable keys per purpose', () => {
    expect(deriveKey(master, 'totp').equals(deriveKey(master, 'totp'))).toBe(true);
    expect(deriveKey(master, 'totp').equals(deriveKey(master, 'csrf'))).toBe(false);
    expect(deriveKey(master, 'totp', 2).equals(deriveKey(master, 'totp', 1))).toBe(false);
  });
});

describe('AES-256-GCM', () => {
  const key = deriveKey(master, 'totp');
  const aad = aadFor('totp_secret', 'secret_ciphertext', 'user-1');

  it('round-trips with the same associated data', () => {
    const blob = encrypt(key, 'JBSWY3DPEHPK3PXP', aad);
    expect(decrypt(key, blob, aad).toString('utf8')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a fresh nonce every time', () => {
    expect(encrypt(key, 'same', aad).equals(encrypt(key, 'same', aad))).toBe(false);
  });

  it('refuses a ciphertext moved to another row', () => {
    const blob = encrypt(key, 'secret', aad);
    expect(() =>
      decrypt(key, blob, aadFor('totp_secret', 'secret_ciphertext', 'user-2')),
    ).toThrow();
  });

  it('refuses a tampered ciphertext or the wrong key', () => {
    const blob = encrypt(key, 'secret', aad);
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 20]! ^= 1;
    expect(() => decrypt(key, tampered, aad)).toThrow();
    expect(() => decrypt(deriveKey(master, 'files'), blob, aad)).toThrow();
  });
});

describe('CSRF tokens', () => {
  const key = deriveKey(master, 'csrf');
  it('verifies only for the same binding', () => {
    const token = csrfToken(key, 'session:a');
    expect(verifyCsrfToken(key, 'session:a', token)).toBe(true);
    expect(verifyCsrfToken(key, 'session:b', token)).toBe(false);
    expect(verifyCsrfToken(key, 'session:a', 'garbage')).toBe(false);
  });
});

describe('passwords', () => {
  const params = { memoryKiB: 19456, iterations: 2, parallelism: 1 };

  it('hashes with Argon2id and verifies', async () => {
    const stored = await hashPassword('correct horse battery staple', params);
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(stored, 'wrong password!!')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('detects outdated parameters', async () => {
    const stored = await hashPassword('correct horse battery staple', params);
    expect(needsRehash(stored, params)).toBe(false);
    expect(needsRehash(stored, { ...params, memoryKiB: 65536 })).toBe(true);
  });

  it('applies the strength rules', () => {
    const rules = { minLength: 12, maxLength: 256 };
    expect(checkPasswordStrength('short', rules)).toBe('too_short');
    expect(checkPasswordStrength('azerty123456', rules)).toBe('too_common');
    expect(checkPasswordStrength('motdepasse12', rules)).toBe('too_common');
    expect(checkPasswordStrength('123456789012', rules)).toBe('too_common');
    expect(checkPasswordStrength('aaaaaaaaaaaa', rules)).toBe('too_repetitive');
    expect(checkPasswordStrength('vélo rouge sous la pluie', rules)).toBeNull();
  });
});

describe('TOTP', () => {
  const secret = generateTotpSecret();
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);

  it('builds an otpauth URI', () => {
    expect(totpUri(secret, 'Job4me', 'user@example.org')).toMatch(/^otpauth:\/\/totp\/Job4me:/);
  });

  it('accepts the current code and returns its step', () => {
    const code = generateTotpCode(secret, now);
    expect(
      verifyTotp({ secretBase32: secret, code, window: 1, lastUsedStep: null, timestamp: now }),
    ).toBe(Math.floor(now / 30000));
  });

  it('accepts a code one step old and refuses older ones', () => {
    const previous = generateTotpCode(secret, now - 30000);
    expect(
      verifyTotp({
        secretBase32: secret,
        code: previous,
        window: 1,
        lastUsedStep: null,
        timestamp: now,
      }),
    ).not.toBeNull();
    const old = generateTotpCode(secret, now - 120000);
    expect(
      verifyTotp({
        secretBase32: secret,
        code: old,
        window: 1,
        lastUsedStep: null,
        timestamp: now,
      }),
    ).toBeNull();
  });

  it('refuses a replayed code', () => {
    const code = generateTotpCode(secret, now);
    const step = verifyTotp({
      secretBase32: secret,
      code,
      window: 1,
      lastUsedStep: null,
      timestamp: now,
    });
    expect(
      verifyTotp({ secretBase32: secret, code, window: 1, lastUsedStep: step, timestamp: now }),
    ).toBeNull();
  });

  it('refuses malformed codes', () => {
    expect(
      verifyTotp({ secretBase32: secret, code: '12a456', window: 1, lastUsedStep: null }),
    ).toBeNull();
  });
});

describe('recovery codes', () => {
  it('generates readable 16-character codes', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  });

  it('normalizes what people type', () => {
    expect(normalizeRecoveryCode('abcd-efgh-jkmn-pqrs')).toBe('ABCDEFGHJKMNPQRS');
    expect(normalizeRecoveryCode(' o1il 2345 6789 abcd ')).toBe('011123456789ABCD');
    expect(normalizeRecoveryCode('too-short')).toBeNull();
    expect(normalizeRecoveryCode('UUUU-UUUU-UUUU-UUUU')).toBeNull();
  });

  it('hashes codes with the recovery key', () => {
    const key = deriveKey(master, 'recovery');
    const a = hashRecoveryCode(key, 'ABCDEFGHJKMNPQRS');
    expect(a.equals(hashRecoveryCode(key, 'ABCDEFGHJKMNPQRS'))).toBe(true);
    expect(
      a.equals(hashRecoveryCode(deriveKey(randomBytes(32), 'recovery'), 'ABCDEFGHJKMNPQRS')),
    ).toBe(false);
  });
});
