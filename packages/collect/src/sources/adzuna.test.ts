import { maskUrl } from '@job4me/logger';
import { describe, expect, it } from 'vitest';
import { cleanOffer } from '../offer';
import { fakeNetwork, fixture, json, runConnector } from '../testing';
import { adzunaConnector } from './adzuna';

// No key yet (decision D2): the answer follows the documented fields, with made-up values. To
// replace with a real answer, anonymized, once the key exists.

const page = () => fixture<{ count: number; results: unknown[] }>('adzuna-page.json');
const params = { where: 'Bruxelles', pageSize: 50 };
const secrets = { adzunaAppId: 'app-id-1', adzunaAppKey: 's3cr3t-app-key' };

describe('Adzuna', () => {
  it('searches without accents, around Bruxelles, within the age limit', async () => {
    const net = fakeNetwork(() => json(page()));
    const result = await runConnector(adzunaConnector, {
      fetch: net.fetch,
      params,
      secrets,
      keywords: ['développeur'],
      maxAgeDays: 60,
    });
    expect(result.error).toBeNull();
    const url = new URL(net.calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://api.adzuna.com/v1/api/jobs/be/search/1');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      app_id: 'app-id-1',
      app_key: 's3cr3t-app-key',
      what: 'developpeur',
      where: 'Bruxelles',
      distance: '40',
      results_per_page: '50',
      max_days_old: '60',
      'content-type': 'application/json',
    });
    // What reaches a log line: neither the identifier nor the key.
    const masked = maskUrl(net.calls[0]!.url);
    expect(masked).not.toContain('s3cr3t');
    expect(masked).not.toContain('app-id-1');
  });

  it('maps the offers, salary included, with "Jobs by Adzuna" on each', async () => {
    const net = fakeNetwork(() => json(page()));
    const { offers } = await runConnector(adzunaConnector, { fetch: net.fetch, params, secrets });
    const [first, second] = offers.map((offer) => cleanOffer(offer, 'adzuna', 1200));
    expect(first).toMatchObject({
      externalId: '4100000001',
      title: 'Comptable junior',
      company: 'Exemple SA',
      location: 'Bruxelles, Région de Bruxelles-Capitale',
      postedAt: '2026-11-20',
      url: 'https://www.adzuna.be/land/ad/4100000001?se=example&utm_medium=api&v=0',
      details: 'CDI · temps plein · Jobs by Adzuna',
      description: 'Pour notre client, nous recherchons un comptable junior & motivé…',
    });
    expect(first!.salary).toBe("35 000 – 42 000 € (estimation d'Adzuna)");
    expect(second).toMatchObject({
      company: '?',
      location: 'Mechelen',
      salary: null,
      details: 'Jobs by Adzuna',
    });
  });

  it('asks for a second page only when the total goes beyond the first', async () => {
    const net = fakeNetwork(() => json(page()));
    await runConnector(adzunaConnector, { fetch: net.fetch, params, secrets, maxPages: 2 });
    expect(net.calls).toHaveLength(1);
    const many = fakeNetwork((url) =>
      json({
        count: 120,
        results: Array.from({ length: url.pathname.endsWith('/1') ? 50 : 20 }, (_, index) => ({
          id: `${url.pathname.at(-1)}-${index}`,
          title: 'Comptable',
          redirect_url: 'https://www.adzuna.be/land/ad/1',
        })),
      }),
    );
    const result = await runConnector(adzunaConnector, {
      fetch: many.fetch,
      params,
      secrets,
      maxPages: 3,
    });
    expect(many.calls.map((call) => new URL(call.url).pathname.at(-1))).toEqual(['1', '2']);
    expect(result.read).toBe(70);
  });
});
