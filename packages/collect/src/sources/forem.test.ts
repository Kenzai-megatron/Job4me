import { describe, expect, it } from 'vitest';
import { cleanOffer } from '../offer';
import { fakeNetwork, fixture, json, runConnector } from '../testing';
import { foremConnector } from './forem';

// Answers of the probe of 23/11/2026, anonymized: employers and offer numbers made up, the
// shape kept (lists of places and languages, doubled employer, a place given as a string).

interface Page {
  total_count: number;
  results: Array<Record<string, unknown>>;
}
const page = () => fixture<Page>('forem-page.json');
const params = { pageSize: 100 };

describe('Forem', () => {
  it('asks the open data for the keyword, around the base city, within the age limit', async () => {
    const net = fakeNetwork(() => json(page()));
    const result = await runConnector(foremConnector, {
      fetch: net.fetch,
      params,
      maxAgeDays: 60,
      radiusKm: 25,
    });
    expect(result.error).toBeNull();
    const url = new URL(net.calls[0]!.url);
    expect(url.origin + url.pathname).toBe(
      'https://www.odwb.be/api/explore/v2.1/catalog/datasets/offres-d-emploi-forem/records',
    );
    expect(url.searchParams.get('where')).toBe(
      `search("comptable") and within_distance(lieuxtravailgeo, geom'POINT(4.3517 50.8467)', 25km) and datedebutdiffusion >= date'2026-09-24'`,
    );
    expect(url.searchParams.get('order_by')).toBe('datedebutdiffusion desc');
    expect(url.searchParams.get('limit')).toBe('100');
    // Around the base city of the profile once it is found (ADR 0017): here Mechelen.
    const around = fakeNetwork(() => json(page()));
    await runConnector(foremConnector, {
      fetch: around.fetch,
      params,
      radiusKm: 25,
      center: { name: 'Mechelen', lat: 51.0257, lon: 4.4776 },
    });
    expect(new URL(around.calls[0]!.url).searchParams.get('where')).toContain(
      `geom'POINT(4.4776 51.0257)', 25km)`,
    );
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.get('select')).toContain('numerooffreforem,titreoffre,nomemployeur');
    // Spaces travel as %20, never as "+".
    expect(net.calls[0]!.url).not.toContain('+');
  });

  it('composes a description with the required languages and cites the source', async () => {
    const net = fakeNetwork(() => json(page()));
    const { offers, read } = await runConnector(foremConnector, { fetch: net.fetch, params });
    expect(read).toBe(3);
    const [first, second, third] = offers.map((offer) => cleanOffer(offer, 'forem', 1200));
    expect(first).toMatchObject({
      externalId: '9100001',
      company: 'Exemple Interim Bruxelles',
      location: 'Laeken, Bruxelles (1020)',
      postedAt: '2026-11-22',
      url: 'https://www.leforem.be/recherche-offres/offre-detail/9100001',
      details: 'Intérimaire avec option sur durée indéterminée · Temps plein',
    });
    expect(first!.description).toContain('Langues : Néerlandais.');
    expect(first!.description).toContain(
      'Source : Le Forem (ODWB, CC BY-SA 4.0), via Exemple Interim.',
    );
    // The employer written twice keeps one half.
    expect(second).toMatchObject({ company: 'Fiduciaire Exemple', location: 'Bruxelles (1000)' });
    expect(second!.description).toContain('Source : Le Forem (ODWB, CC BY-SA 4.0).');
    expect(third).toMatchObject({
      company: '?',
      location: 'Wavre (1300)',
      url: 'https://www.leforem.be/recherche-offres/offre-detail/9100003',
      details: 'Durée indéterminée',
    });
    expect(third!.description).toContain('Langues : Français, Néerlandais.');
  });

  it('keeps the ODSQL string closed whatever the keyword holds', async () => {
    const net = fakeNetwork(() => json({ total_count: 0, results: [] }));
    await runConnector(foremConnector, {
      fetch: net.fetch,
      params,
      keywords: ['comptable "senior") or (true'],
    });
    const where = new URL(net.calls[0]!.url).searchParams.get('where')!;
    expect(where.startsWith('search("comptable senior ) or (true")')).toBe(true);
  });

  it('turns the page only while the total goes beyond it', async () => {
    const full = {
      total_count: 250,
      results: Array.from({ length: 100 }, (_, index) => ({
        ...page().results[1],
        numerooffreforem: String(9_200_000 + index),
      })),
    };
    const net = fakeNetwork(() => json(full));
    const result = await runConnector(foremConnector, { fetch: net.fetch, params, maxPages: 2 });
    expect(net.calls.map((call) => new URL(call.url).searchParams.get('offset'))).toEqual([
      '0',
      '100',
    ]);
    expect(result.read).toBe(200);
  });
});
