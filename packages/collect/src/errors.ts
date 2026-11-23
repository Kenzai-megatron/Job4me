import type { CollectErrorCode, SkipReason } from '@job4me/contracts';

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

/**
 * Thrown by a connector that finds, before its first search, that it must not run: a quota
 * under its reserve. The run is then "skipped" with this reason, never "0 offers".
 */
export class SourceSkipped extends Error {
  override name = 'SourceSkipped';

  constructor(readonly reason: SkipReason) {
    super(`skipped: ${reason}`);
  }
}
