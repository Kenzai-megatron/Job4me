import { describe, expect, it } from 'vitest';
import { cleanOffer } from '../offer';
import { fakeNetwork, fixture, json, runConnector, TEST_HTTP } from '../testing';
import { actirisConnector } from './actiris';

// Answers of the probe of 23/11/2026, anonymized: references, company numbers and some titles
// made up, the shape and the quirks kept (empty communes, Dutch-only titles, relayed offers).

interface Page {
  total: number;
  offers: Array<Record<string, unknown>>;
}
const page = () => fixture<Page>('actiris-page.json');
const params = { pageSize: 100 };

describe('Actiris', () => {
  it('posts exactly the documented body, the keyword searched in titles', async () => {
    const net = fakeNetwork(() => json(page()));
    const result = await runConnector(actirisConnector, { fetch: net.fetch, params });
    expect(result.error).toBeNull();
    expect(net.calls).toHaveLength(1);
    const [call] = net.calls;
    expect(call).toMatchObject({
      url: 'https://www.actiris.brussels/api/Offer/GetAllOffers',
      method: 'POST',
    });
    // Without Accept-Language every request answered 500: the ordinary browser one is sent.
    expect(call!.headers['Accept-Language']).toBe(TEST_HTTP.acceptLanguage);
    expect(call!.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call!.body!)).toEqual({
      pageOption: { page: 1, from: 0, pageSize: 100 },
      offreFilter: { texte: 'comptable', keywordSearchType: 'Titre', localisation: 'Tout' },
    });
  });

  it('maps titles in French or Dutch, the commune and its postal code, never an employer', async () => {
    const net = fakeNetwork(() => json(page()));
    const { offers, read } = await runConnector(actirisConnector, { fetch: net.fetch, params });
    expect(read).toBe(5);
    expect(offers.map((offer) => cleanOffer(offer, 'actiris', 1200))).toEqual([
      expect.objectContaining({
        externalId: '9000001',
        title: 'Comptable Junior /X) H/F/X',
        company: '?',
        location: '1000',
        postedAt: '2026-11-23',
        url: 'https://www.actiris.brussels/fr/citoyens/offres-demploi/?keywords=9000001',
        details: 'Durée indéterminée',
        description: '',
      }),
      expect.objectContaining({
        externalId: '9000002',
        title: 'Boekhouder - full package M/V/X',
        location: 'Bruxelles (1000)',
        postedAt: '2026-11-23',
        details: 'Interim · temps partiel',
      }),
      // Relayed from another region: Actiris' own address is not the place of work.
      expect.objectContaining({ externalId: '9000003', company: '?', location: 'Tielt-Winge' }),
      expect.objectContaining({
        externalId: '9000004',
        location: 'Groot-Bijgaarden (1702)',
        details: 'Durée déterminée · 6 mois',
      }),
      expect.objectContaining({ externalId: '9000005', postedAt: '2026-08-01' }),
    ]);
  });

  it('reads but does not keep ads older than the limit', async () => {
    const net = fakeNetwork(() => json(page()));
    const result = await runConnector(actirisConnector, {
      fetch: net.fetch,
      params,
      maxAgeDays: 60,
    });
    expect(result.read).toBe(5);
    expect(result.offers.map((offer) => offer.externalId)).toEqual([
      '9000001',
      '9000002',
      '9000003',
      '9000004',
    ]);
  });

  it('pages through the results up to the total, the pages being disjoint', async () => {
    const net = fakeNetwork(() => json({ ...page(), total: 12 }));
    await runConnector(actirisConnector, {
      fetch: net.fetch,
      params: { pageSize: 5 },
      maxPages: 3,
    });
    const bodies = net.calls.map((call) => JSON.parse(call.body!) as { pageOption: unknown });
    expect(bodies.map((body) => body.pageOption)).toEqual([
      { page: 1, from: 0, pageSize: 5 },
      { page: 2, from: 5, pageSize: 5 },
      { page: 3, from: 10, pageSize: 5 },
    ]);
  });

  it('fails cleanly when the list changes its name again (it was "items" before 10/10/2026)', async () => {
    const net = fakeNetwork(() => json({ total: 1, items: page().offers }));
    const result = await runConnector(actirisConnector, { fetch: net.fetch, params });
    expect(result.error).toMatchObject({ code: 'invalid_response' });
    expect(result.offers).toEqual([]);
  });
});
