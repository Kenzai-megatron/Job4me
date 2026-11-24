import type { KeywordLevel, PassTrigger, SourceAccess, SourceFamily } from '@job4me/contracts';
import type { Logger } from '@job4me/logger';
import type { ZodType } from 'zod';
import { asCollectError, type CollectError } from './errors';
import type { PoliteClient } from './http';
import type { RawOffer } from './offer';

// The contract of a connector (docs/SOURCES.md, section 1.2; ADR 0013). A connector hands over
// each page of results as it reads it, so that a source stopped by its budget or by a 429 still
// gives what it has read. Its pauses, budget, retries and pages are in the configuration
// (collect.sources.<name>).

export interface ConnectorContext {
  trigger: PassTrigger;
  /** Keywords of the source's level, a single one in test mode, none for a fixed-list source. */
  keywords: readonly string[];
  baseCity: string | null;
  basePostalCode: string | null;
  radiusKm: number;
  /** Result pages to read per keyword: one in test mode. */
  maxPages: number;
  http: PoliteClient;
  /** Only the secrets this connector declares, all present (otherwise it is skipped). */
  secrets: Readonly<Record<string, string>>;
  /** The city of the configuration, for the sites searched by city name (StepStone, Talent.com). */
  area: { name: string; lat: number; lon: number };
  /**
   * Centre of the searches around a point (the Forem): the profile's base city once found in the
   * localities (ADR 0017), the configured area otherwise.
   */
  center: { name: string; lat: number; lon: number };
  /** Ads older than this are neither asked for nor kept; null: no limit. */
  maxAgeDays: number | null;
  /** The source's own values from the configuration (collect.sources.<name>.params). */
  params: Readonly<Record<string, string | number | boolean>>;
  now: Date;
  timeZone: string;
  signal: AbortSignal;
  log: Logger;
  /** A page of results: its offers, and how many ads were read on it before any filter. */
  add(offers: readonly RawOffer[], readCount?: number): void;
  /** A failure that does not stop the source, such as one keyword out of ten. */
  warn(error: CollectError): void;
  /** Searches left on a rationed source (SerpApi), stored with its settings. */
  reportQuota(remaining: number): void;
}

export interface Connector {
  name: string;
  access: SourceAccess;
  family: SourceFamily;
  keywordLevel: KeywordLevel;
  /** LinkedIn guest and every public page: switched off in commercial mode (ADR 0014). */
  personalUseOnly: boolean;
  /** The profile's title filter applies (OR searches, fixed lists), never on precise sources. */
  titleFilter: boolean;
  /** Exact HTTPS hosts the connector may reach. */
  hosts: readonly string[];
  /** Names of the secrets it needs; without them it is "skipped, key missing". */
  secrets: readonly string[];
  /** The shape of collect.sources.<name>.params, checked at start-up. */
  params?: ZodType;
  run(context: ConnectorContext): Promise<void>;
}

/**
 * Runs `visit` for each keyword. A failing keyword is recorded and the next one tried; a 403, a
 * 429, a host outside the list or the end of the budget stops everything. When every keyword
 * fails, the source fails with the last error.
 */
export async function eachKeyword(
  context: ConnectorContext,
  visit: (keyword: string) => Promise<void>,
): Promise<void> {
  let last: CollectError | null = null;
  let failures = 0;
  for (const keyword of context.keywords) {
    try {
      await visit(keyword);
    } catch (error) {
      const failure = asCollectError(error);
      if (failure.fatal) throw failure;
      failures += 1;
      last = failure;
      context.warn(failure);
    }
  }
  if (last !== null && failures === context.keywords.length) throw last;
}
