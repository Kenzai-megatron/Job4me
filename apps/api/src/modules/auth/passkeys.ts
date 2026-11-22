import type { Settings } from '@job4me/config';
import type { PasskeySummary } from '@job4me/contracts';
import { and, asc, eq, type Executor, schema } from '@job4me/db';
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

// ES256, EdDSA and RS256 (Windows Hello) cover every current authenticator.
const ALGORITHMS = [-7, -8, -257];

/** A few well-known passkey providers (public AAGUIDs), shown next to the user's own name. */
const PROVIDERS: Record<string, string> = {
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain', // gitleaks:allow (public AAGUID)
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager', // gitleaks:allow (public AAGUID)
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello', // gitleaks:allow (public AAGUID)
};

export type PasskeyRow = typeof schema.passkeys.$inferSelect;

export function listPasskeys(db: Executor, userId: string) {
  return db
    .select()
    .from(schema.passkeys)
    .where(eq(schema.passkeys.userId, userId))
    .orderBy(asc(schema.passkeys.createdAt));
}

export function summarizePasskey(row: PasskeyRow): PasskeySummary {
  return {
    id: row.id,
    name: row.name,
    provider: row.aaguid ? (PROVIDERS[row.aaguid] ?? null) : null,
    backedUp: row.backedUp,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

function descriptors(passkeys: PasskeyRow[]) {
  return passkeys.map((passkey) => ({
    id: passkey.credentialId,
    transports: passkey.transports as AuthenticatorTransport[],
  }));
}

export function registrationOptions(
  settings: Settings,
  user: { email: string; displayName: string; webauthnUserHandle: Buffer },
  existing: PasskeyRow[],
) {
  return generateRegistrationOptions({
    rpName: settings.app.rpName,
    rpID: settings.app.rpId,
    userName: user.email,
    userDisplayName: user.displayName,
    userID: new Uint8Array(user.webauthnUserHandle),
    attestationType: 'none',
    excludeCredentials: descriptors(existing),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    supportedAlgorithmIDs: ALGORITHMS,
  });
}

export function authenticationOptions(settings: Settings, allowed: PasskeyRow[] = []) {
  return generateAuthenticationOptions({
    rpID: settings.app.rpId,
    userVerification: 'required',
    allowCredentials: descriptors(allowed),
  });
}

/** Verifies a registration; throws when the browser's answer is not acceptable. */
export async function verifyRegistration(
  settings: Settings,
  allowedOrigins: string[],
  response: RegistrationResponseJSON,
  expectedChallenge: string,
) {
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: allowedOrigins,
    expectedRPID: settings.app.rpId,
    requireUserVerification: true,
    supportedAlgorithmIDs: ALGORITHMS,
  });
  if (!result.verified) throw new Error('registration not verified');
  return result.registrationInfo;
}

export async function storePasskey(
  db: Executor,
  input: {
    userId: string;
    name: string;
    info: Awaited<ReturnType<typeof verifyRegistration>>;
  },
) {
  const { credential } = input.info;
  const aaguid = /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(input.info.aaguid) ? null : input.info.aaguid;
  const [row] = await db
    .insert(schema.passkeys)
    .values({
      userId: input.userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      signCount: credential.counter,
      transports: credential.transports ?? [],
      aaguid,
      deviceType: input.info.credentialDeviceType,
      backedUp: input.info.credentialBackedUp,
      name: input.name,
    })
    .returning();
  return row!;
}

export async function findPasskeyByCredentialId(db: Executor, credentialId: string) {
  const [row] = await db
    .select()
    .from(schema.passkeys)
    .where(eq(schema.passkeys.credentialId, credentialId))
    .limit(1);
  return row ?? null;
}

/**
 * Verifies an assertion against a stored passkey, including the signature counter:
 * a counter that goes backwards reveals a cloned authenticator (synced passkeys report 0).
 */
export async function verifyAssertion(
  settings: Settings,
  allowedOrigins: string[],
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  passkey: PasskeyRow,
) {
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: allowedOrigins,
    expectedRPID: settings.app.rpId,
    requireUserVerification: true,
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(passkey.publicKey),
      counter: passkey.signCount,
      transports: passkey.transports,
    },
  });
  if (!result.verified) throw new Error('assertion not verified');
  const { newCounter } = result.authenticationInfo;
  if (passkey.signCount > 0 && newCounter <= passkey.signCount) {
    throw new Error('signature counter went backwards');
  }
  return result.authenticationInfo;
}

export async function markPasskeyUsed(
  db: Executor,
  id: string,
  input: { counter: number; backedUp: boolean; now: Date },
) {
  await db
    .update(schema.passkeys)
    .set({ signCount: input.counter, backedUp: input.backedUp, lastUsedAt: input.now })
    .where(eq(schema.passkeys.id, id));
}

export async function renamePasskey(db: Executor, userId: string, id: string, name: string) {
  const [row] = await db
    .update(schema.passkeys)
    .set({ name })
    .where(and(eq(schema.passkeys.id, id), eq(schema.passkeys.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deletePasskey(db: Executor, userId: string, id: string) {
  const rows = await db
    .delete(schema.passkeys)
    .where(and(eq(schema.passkeys.id, id), eq(schema.passkeys.userId, userId)))
    .returning({ id: schema.passkeys.id });
  return rows.length > 0;
}
