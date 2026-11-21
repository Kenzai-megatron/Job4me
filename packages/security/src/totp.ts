import { Secret, TOTP } from 'otpauth';

// RFC 6238 defaults understood by every authenticator app.
const ALGORITHM = 'SHA1';
const DIGITS = 6;
const PERIOD = 30;

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function build(secretBase32: string, issuer: string, label: string): TOTP {
  return new TOTP({
    issuer,
    label,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** otpauth:// URI for the QR code shown during enrollment. */
export function totpUri(secretBase32: string, issuer: string, label: string): string {
  return build(secretBase32, issuer, label).toString();
}

export function generateTotpCode(secretBase32: string, timestamp: number = Date.now()): string {
  return build(secretBase32, 'job4me', 'code').generate({ timestamp });
}

export interface TotpCheck {
  secretBase32: string;
  code: string;
  window: number;
  /** Last accepted time step: a code from this step or an earlier one is a replay. */
  lastUsedStep: number | null;
  timestamp?: number;
}

/** Returns the time step of an accepted code, or null if the code is wrong or replayed. */
export function verifyTotp(check: TotpCheck): number | null {
  if (!/^\d{6}$/.test(check.code)) return null;
  const timestamp = check.timestamp ?? Date.now();
  const totp = build(check.secretBase32, 'job4me', 'code');
  const delta = totp.validate({
    token: check.code,
    timestamp,
    window: check.window,
    afterCounter: check.lastUsedStep ?? undefined,
  });
  if (delta === null) return null;
  return totp.counter({ timestamp }) + delta;
}
