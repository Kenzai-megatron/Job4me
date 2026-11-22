import { type Algorithm, hash, parseOptions, verify } from '@node-rs/argon2';

export interface Argon2Params {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

// Argon2id; the package exposes its algorithm list as an ambient const enum.
const ARGON2ID = 2 as Algorithm;

export function hashPassword(password: string, params: Argon2Params): Promise<string> {
  return hash(password, {
    algorithm: ARGON2ID,
    memoryCost: params.memoryKiB,
    timeCost: params.iterations,
    parallelism: params.parallelism,
    outputLen: 32,
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** True when a stored hash was made with other parameters than the configured ones. */
export function needsRehash(passwordHash: string, params: Argon2Params): boolean {
  try {
    const parsed = parseOptions(passwordHash);
    return (
      parsed.algorithm !== ARGON2ID ||
      parsed.memoryCost !== params.memoryKiB ||
      parsed.timeCost !== params.iterations ||
      parsed.parallelism !== params.parallelism
    );
  } catch {
    return true;
  }
}

/** Letters of passwords too common to accept, once digits and symbols are removed. */
const COMMON = new Set([
  'password',
  'passwords',
  'motdepasse',
  'wachtwoord',
  'azerty',
  'azertyuiop',
  'qwerty',
  'qwertyuiop',
  'jobme',
  'admin',
  'welcome',
  'bienvenue',
  'letmein',
  'iloveyou',
  'abcdef',
  'abcdefgh',
]);

export type PasswordProblem = 'too_short' | 'too_long' | 'too_common' | 'too_repetitive';

/** Basic strength rules: length first (NIST SP 800-63B), then obvious patterns. */
export function checkPasswordStrength(
  password: string,
  rules: { minLength: number; maxLength: number },
): PasswordProblem | null {
  const length = [...password].length;
  if (length < rules.minLength) return 'too_short';
  if (length > rules.maxLength) return 'too_long';
  const letters = password.toLowerCase().replaceAll(/[^a-z]/g, '');
  if (letters.length === 0 || COMMON.has(letters)) return 'too_common';
  if (new Set(password).size < 5) return 'too_repetitive';
  return null;
}
