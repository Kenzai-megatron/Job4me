import { z } from 'zod';

/** Error codes the API returns; the interface translates them (never shows raw messages). */
export const errorCodes = [
  'validation_error',
  'invalid_body',
  'payload_too_large',
  'unsupported_media_type',
  'not_found',
  'unauthenticated',
  'forbidden',
  'csrf_failed',
  'reauth_required',
  'rate_limited',
  'locked',
  'invalid_credentials',
  'invalid_code',
  'link_invalid',
  'passkey_failed',
  'password_too_weak',
  'last_sign_in_method',
  'totp_not_ready',
  'push_not_configured',
  'duplicate',
  'limit_reached',
  'unsupported_file',
  'file_too_large',
  'file_too_complex',
  'file_protected',
  'file_macros',
  'database_unavailable',
  'migrations_pending',
  'internal_error',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const errorResponseSchema = z.object({
  error: z.enum(errorCodes),
  requestId: z.string().optional(),
  retryAfterSeconds: z.number().int().optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
