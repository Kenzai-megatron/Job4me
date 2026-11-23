import { describe, expect, it } from 'vitest';
import { SourceSkipped } from '../errors';
import { cleanOffer } from '../offer';
import { fakeNetwork, fixture, json, runConnector } from '../testing';
import { googleJobsConnector } from './google-jobs';

// No key yet (decision D2): the answers follow the documented fields, with made-up values. To
// replace with real answers, anonymized, once the key exists.

const params = { location: 'Brussels, Belgium', language: 'fr', country: 'be', quotaReserve: 20 };
const secrets = { serpApiKey: 's3rp-k3y' };

function network(left: number, search = 'serpapi-search.json') {
  return fakeNetwork((url) =>
    url.pathname === '/account.json'
      ? json({ ...fixture<object>('serpapi-account.json'), plan_searches_left: left })
      : json(fixture(search)),
  );
}

describe('Google Jobs (SerpApi)', () => {
  it('reads the account first, then searches the priority keywords', async () => {
    const net = network(120);
    const result = await runConnector(googleJobsConnector, {
      fetch: net.fetch,
      params,
      secrets,
      keywords: ['comptable', 'boekhouder'],
    });
    expect(result.error).toBeNull();
    expect(result.quota).toBe(120);
    expect(net.calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/account.json',
      '/search.json',
      '/search.json',
    ]);
    const search = new URL(net.calls[1]!.url);
    expect(Object.fromEntries(search.searchParams)).toEqual({
      engine: 'google_jobs',
      q: 'comptable',
      location: 'Brussels, Belgium',
      hl: 'fr',
      gl: 'be',
      api_key: 's3rp-k3y',
    });
  });

  it('maps the offers with a stable identifier and a web link only', async () => {
    const net = network(120);
    const { offers } = await runConnector(googleJobsConnector, {
      fetch: net.fetch,
      params,
      secrets,
    });
    const [first, second] = offers.map((offer) => cleanOffer(offer, 'google_jobs', 1200));
    expect(first).toMatchObject({
      title: 'Comptable (H/F/X)',
      company: 'Exemple SA',
      location: 'Bruxelles, Belgique',
      postedAt: '2026-11-20',
      url: 'https://www.linkedin.com/jobs/view/0000000001',
      details: 'Temps plein · LinkedIn',
    });
    expect(first!.externalId).toMatch(/^[0-9a-f]{40}$/);
    // A javascript: link is never kept: the share link stands in.
    expect(second).toMatchObject({
      url: 'https://www.google.com/search?ibp=htl;jobs&q=boekhouder#htidocid=example2',
      postedAt: '2026-10-24',
      salary: '3 000–3 500 € par mois',
      details: 'Jobat',
    });
    const again = await runConnector(googleJobsConnector, {
      fetch: network(120).fetch,
      params,
      secrets,
    });
    expect(again.offers[0]!.externalId).toBe(offers[0]!.externalId);
  });

  it('is skipped under the reserve, without spending a search', async () => {
    const net = network(15);
    const result = await runConnector(googleJobsConnector, { fetch: net.fetch, params, secrets });
    expect(result.error).toBeInstanceOf(SourceSkipped);
    expect((result.error as SourceSkipped).reason).toBe('quota');
    expect(result.quota).toBe(15);
    expect(net.calls).toHaveLength(1);
  });

  it('searches only what stays above the reserve', async () => {
    const net = network(22);
    await runConnector(googleJobsConnector, {
      fetch: net.fetch,
      params,
      secrets,
      keywords: ['a', 'b', 'c', 'd'],
    });
    expect(net.calls.filter((call) => call.url.includes('/search.json'))).toHaveLength(2);
  });

  it('takes "no result" for what it is, not for an error', async () => {
    const result = await runConnector(googleJobsConnector, {
      fetch: network(120, 'serpapi-empty.json').fetch,
      params,
      secrets,
    });
    expect(result.error).toBeNull();
    expect(result.offers).toEqual([]);
  });
});
