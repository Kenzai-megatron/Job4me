import type { CollectErrorCode } from '@job4me/contracts';

/** These stop the whole source for the pass: no other keyword, no retry (ADR 0014). */
const FATAL = new Set<CollectErrorCode>(['blocked', 'host_not_allowed', 'budget_exceeded']);

/**
 * A failure of a source, by code. Its message never holds a URL, a key or page content: it may
 * be logged and stored as it is (phase 2 plan, section 9, threat 3).
 */
export class CollectError extends Error {
  override name = 'CollectError';

  constructor(
    readonly code: CollectErrorCode,
    readonly httpStatus: number | null = null,
  ) {
    super(httpStatus === null ? code : `${code} (HTTP ${httpStatus})`);
  }

  /** 403, 429, a host outside the list or the end of the budget: the source stops at once. */
  get fatal(): boolean {
    return FATAL.has(this.code);
  }
}

/** Anything else a connector throws (a bug, a page that no longer parses) is its own error. */
export function asCollectError(error: unknown): CollectError {
  return error instanceof CollectError ? error : new CollectError('connector_error');
}
