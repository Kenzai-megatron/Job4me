import { z } from 'zod';

// Authentication contracts (ADR 0003). Dates travel as ISO 8601 strings.

const base64url = z
  .string()
  .regex(/^[A-Za-z0-9_-]*$/)
  .max(16_384);
const isoDate = z.string();

export const enrollmentTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const passkeyNameSchema = z.string().trim().min(1).max(64);
export const secondFactorCodeSchema = z.string().trim().min(6).max(32);

/** WebAuthn options as produced by the server library; passed as-is to the browser. */
export const webauthnOptionsSchema = z.looseObject({ challenge: z.string() });

export const registrationResponseSchema = z.looseObject({
  id: base64url.max(1024),
  rawId: base64url.max(1024),
  type: z.literal('public-key'),
  response: z.looseObject({
    clientDataJSON: base64url,
    attestationObject: base64url,
    transports: z.array(z.string().max(32)).max(10).optional(),
  }),
  clientExtensionResults: z.looseObject({}).optional(),
  authenticatorAttachment: z.string().max(32).optional(),
});

export const authenticationResponseSchema = z.looseObject({
  id: base64url.max(1024),
  rawId: base64url.max(1024),
  type: z.literal('public-key'),
  response: z.looseObject({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.optional(),
  }),
  clientExtensionResults: z.looseObject({}).optional(),
  authenticatorAttachment: z.string().max(32).optional(),
});

export const optionsResponseSchema = z.object({ options: webauthnOptionsSchema });

export const enrollOptionsRequestSchema = z.object({ token: enrollmentTokenSchema });
export const enrollVerifyRequestSchema = z.object({
  token: enrollmentTokenSchema,
  response: registrationResponseSchema,
  name: passkeyNameSchema.optional(),
});

export const passkeyVerifyRequestSchema = z.object({ response: authenticationResponseSchema });

export const passwordLoginRequestSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
});
export const passwordStepResponseSchema = z.object({ next: z.literal('second_factor') });
export const secondFactorRequestSchema = z.object({ code: secondFactorCodeSchema });

/** Returned on sign-in: the CSRF token changes with the session. */
export const signedInResponseSchema = z.object({ ok: z.literal(true), csrfToken: z.string() });

export const reauthPasswordRequestSchema = z.object({
  password: z.string().min(1).max(1024),
  code: secondFactorCodeSchema,
});
export const reauthResponseSchema = z.object({ reauthUntil: isoDate, csrfToken: z.string() });

export const totpSetupResponseSchema = z.object({
  secret: z.string(),
  uri: z.string(),
  qrCode: z.string(),
});
export const totpConfirmRequestSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export const recoveryCodesResponseSchema = z.object({ codes: z.array(z.string()) });

export const passkeySummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  provider: z.string().nullable(),
  backedUp: z.boolean(),
  createdAt: isoDate,
  lastUsedAt: isoDate.nullable(),
});
export type PasskeySummary = z.infer<typeof passkeySummarySchema>;

export const addPasskeyVerifyRequestSchema = z.object({
  response: registrationResponseSchema,
  name: passkeyNameSchema.optional(),
});
export const renamePasskeyRequestSchema = z.object({ name: passkeyNameSchema });

export const securityOverviewSchema = z.object({
  passkeys: z.array(passkeySummarySchema),
  totpEnabled: z.boolean(),
  recoveryCodesRemaining: z.number().int(),
  password: z.object({ isSet: z.boolean(), fallbackEnabled: z.boolean() }),
  reauthUntil: isoDate,
});
export type SecurityOverview = z.infer<typeof securityOverviewSchema>;

export const changePasswordRequestSchema = z.object({ newPassword: z.string().min(1).max(1024) });
export const passwordFallbackRequestSchema = z.object({ enabled: z.boolean() });

export const authMethods = ['passkey', 'password_totp', 'password_recovery'] as const;

export const sessionSummarySchema = z.object({
  id: z.uuid(),
  authMethod: z.enum(authMethods),
  userAgentLabel: z.string().nullable(),
  createdAt: isoDate,
  lastSeenAt: isoDate,
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export const sessionsResponseSchema = z.object({ sessions: z.array(sessionSummarySchema) });
export const revokedResponseSchema = z.object({ revoked: z.number().int() });

export const auditEntrySchema = z.object({
  id: z.number().int(),
  occurredAt: isoDate,
  action: z.string(),
  outcome: z.enum(['success', 'failure', 'denied']),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
});
export const auditResponseSchema = z.object({ entries: z.array(auditEntrySchema) });

export const okResponseSchema = z.object({ ok: z.literal(true) });
export const idParamsSchema = z.object({ id: z.uuid() });
