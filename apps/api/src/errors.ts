import type { ErrorCode } from '@job4me/contracts';

/** An error the client may see: a status code and a stable code, never internal details. */
export class HttpError extends Error {
  override name = 'HttpError';

  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    readonly extra: { retryAfterSeconds?: number } = {},
  ) {
    super(code);
  }
}
