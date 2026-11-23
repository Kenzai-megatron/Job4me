import { readFileSync } from 'node:fs';
import { createLogger } from '@job4me/logger';
import type { Connector, ConnectorContext } from './connector';
import type { CollectError } from './errors';
import { type FetchLike, PoliteClient } from './http';
import type { RawOffer } from './offer';

// Tests only: a fake network and a connector run without the database, as the orchestrator
// would run it. No request ever leaves the machine.

export interface Call {
  url: string;
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
}

/** Answers by route; every call is recorded. */
export function fakeNetwork(route: (url: URL, call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? init.body : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    return route(new URL(url), call);
  };
  return { calls, fetch };
}

export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** A test answer kept next to the connectors, anonymized (ADR 0015). */
export function fixture<T = unknown>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./sources/fixtures/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

export const TEST_HTTP = {
  userAgent: 'Mozilla/5.0 (test) Chrome/142.0.0.0',
  acceptLanguage: 'fr-BE,fr;q=0.9,nl;q=0.8,en;q=0.7',
  timeoutMs: 2000,
  maxResponseBytes: 5_242_880,
  maxRedirects: 3,
  retryBaseMs: 1,
};

export interface RunOptions {
  fetch: FetchLike;
  keywords?: string[];
  params?: Record<string, string | number | boolean>;
  secrets?: Record<string, string>;
  maxPages?: number;
  maxAgeDays?: number | null;
  radiusKm?: number;
  trigger?: ConnectorContext['trigger'];
  now?: Date;
  /** The HTTP settings of the configuration, for a run against a real site. */
  http?: typeof TEST_HTTP;
}

/** Runs a connector on the fake network and returns what it handed over. */
export async function runConnector(connector: Connector, options: RunOptions) {
  const offers: RawOffer[] = [];
  const warnings: CollectError[] = [];
  let read = 0;
  let quota: number | null = null;
  const signal = new AbortController().signal;
  const http = new PoliteClient({
    source: connector.name,
    hosts: connector.hosts,
    pauseMs: 0,
    retries: 0,
    http: options.http ?? TEST_HTTP,
    signal,
    fetch: options.fetch,
    sleep: () => Promise.resolve(),
  });
  const context: ConnectorContext = {
    trigger: options.trigger ?? 'manual',
    keywords: options.keywords ?? ['comptable'],
    baseCity: null,
    basePostalCode: null,
    radiusKm: options.radiusKm ?? 40,
    maxPages: options.maxPages ?? 1,
    http,
    secrets: options.secrets ?? {},
    area: { name: 'Bruxelles', lat: 50.8467, lon: 4.3517 },
    maxAgeDays: options.maxAgeDays === undefined ? null : options.maxAgeDays,
    params: options.params ?? {},
    // Monday 23 November 2026, 10:00 in Brussels.
    now: options.now ?? new Date('2026-11-23T09:00:00Z'),
    timeZone: 'Europe/Brussels',
    signal,
    log: createLogger({ name: 'test', level: 'silent' }),
    add(list, count) {
      offers.push(...list);
      read += count ?? list.length;
    },
    warn(error) {
      warnings.push(error);
    },
    reportQuota(remaining) {
      quota = remaining;
    },
  };
  let error: unknown = null;
  try {
    await connector.run(context);
  } catch (caught) {
    error = caught;
  }
  return { offers, read, warnings, quota, error, requests: http.requestCount };
}
