import { describe, expect, it } from 'vitest';
import { oneHalf } from '../html';
import { cleanOffer } from '../offer';
import { fakeNetwork, fixtureText, html, runConnector } from '../testing';
import { jobijobaConnector, jobijobaUrl } from './jobijoba';
import { jobrapidoConnector, jobrapidoUrl } from './jobrapido';
import { slug, stepstoneConnector } from './stepstone';
import { talentConnector } from './talent';

// The four public pages (lot 3), on pages built from the probe of 23/11/2026: the real markup
// (tags, classes, data attributes, <style> blocks), with made-up employers, numbers and texts.

const clean = (offers: Parameters<typeof cleanOffer>[0][], source: string) =>
  offers.map((offer) => cleanOffer(offer, source, 1200));

describe('StepStone', () => {
  const params = { pageSize: 25 };

  it('asks the city page with the radius, the keyword as a slug', async () => {
    const net = fakeNetwork(() => html(fixtureText('stepstone-page.html')));
    await runConnector(stepstoneConnector, {
      fetch: net.fetch,
      params,
      keywords: ['Contrôleur de gestion'],
      radiusKm: 30,
    });
    expect(net.calls[0]!.url).toBe(
      'https://www.stepstone.be/emplois/controleur-de-gestion/a-bruxelles?radius=30&page=1',
    );
    expect(net.calls[0]!.headers.Accept).toContain('text/html');
    expect(slug('Développeur .NET / C#')).toBe('developpeur-net-c');
  });

  it('reads the cards without their <style> blocks, nor the scripts of the page', async () => {
    const net = fakeNetwork(() => html(fixtureText('stepstone-page.html')));
    const { offers, read, error } = await runConnector(stepstoneConnector, {
      fetch: net.fetch,
      params,
      maxAgeDays: 60,
    });
    expect(error).toBeNull();
    // Three cards: neither the CSS selector nor the script's markup counts as one.
    expect(read).toBe(3);
    const [first, second] = clean(offers, 'stepstone');
    expect(first).toEqual({
      source: 'stepstone',
      externalId: '1000001',
      title: 'Comptable | Autonomie & environnement exemplaire',
      company: 'Exemple SA',
      location: 'Bruxelles',
      postedAt: '2026-11-19',
      url: 'https://www.stepstone.be/offres-d-emploi--Comptable-Autonomie-Bruxelles-Exemple-SA--1000001-inline.html',
      salary: null,
      description:
        'Notre client, une société fictive du centre de Bruxelles, recherche un comptable pour son équipe financière.',
      details: 'Télétravail possible',
    });
    expect(second).toMatchObject({
      externalId: '1000002',
      company: '?',
      location: 'Wavre',
      postedAt: '2026-11-23',
      url: 'https://www.stepstone.be/offres-d-emploi--Aide-comptable-Wavre--1000002-inline.html',
    });
    // The third card is three months old: read, not kept.
    expect(offers).toHaveLength(2);
  });

  it('takes the number from the address when the card has no id', async () => {
    const net = fakeNetwork(() => html(fixtureText('stepstone-page.html')));
    const { offers } = await runConnector(stepstoneConnector, { fetch: net.fetch, params });
    expect(offers.map((offer) => offer.externalId)).toEqual(['1000001', '1000002', '1000003']);
  });

  it('turns the page only while the total goes beyond it', async () => {
    const card = (id: number) =>
      `<article id="job-item-${id}" data-at="job-item"><a data-at="job-item-title" href="/offres-d-emploi--X--${id}-inline.html">Comptable</a></article>`;
    const page = (count: number, from: number) =>
      `<div data-resultlist-offers-total="60"></div>${Array.from({ length: count }, (_, index) => card(from + index)).join('')}`;
    const net = fakeNetwork((url) => {
      const number = Number(url.searchParams.get('page'));
      return html(page(number < 3 ? 25 : 10, number * 100));
    });
    const result = await runConnector(stepstoneConnector, {
      fetch: net.fetch,
      params,
      maxPages: 5,
    });
    expect(net.calls.map((call) => new URL(call.url).searchParams.get('page'))).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(result.read).toBe(60);
  });

  it('fails cleanly when the template changes, never "0 offers" in silence', async () => {
    const net = fakeNetwork(() => html('<html><body><div class="new-layout"></div></body></html>'));
    const result = await runConnector(stepstoneConnector, { fetch: net.fetch, params });
    expect(result.error).toMatchObject({ code: 'invalid_response' });
    const none = fakeNetwork(() => html('<div data-resultlist-offers-total="0"></div>'));
    expect(
      (await runConnector(stepstoneConnector, { fetch: none.fetch, params })).error,
    ).toBeNull();
  });
});

describe('Jobijoba', () => {
  it('asks without any city, the keyword capitalised and form-encoded', () => {
    expect(jobijobaUrl('comptable', 1)).toBe(
      'https://www.jobijoba.be/emploi/offres-emploi-Comptable.html',
    );
    expect(jobijobaUrl('aide comptable', 2)).toBe(
      'https://www.jobijoba.be/emploi/offres-emploi-Aide+comptable.html?page=2',
    );
    expect(jobijobaUrl('élève', 1)).toBe(
      'https://www.jobijoba.be/emploi/offres-emploi-%C3%89l%C3%A8ve.html',
    );
  });

  it('keeps the offers with a plain link, and never decodes a sponsored one', async () => {
    const net = fakeNetwork(() => html(fixtureText('jobijoba-page.html')));
    const { offers, read } = await runConnector(jobijobaConnector, { fetch: net.fetch });
    expect(read).toBe(3);
    const [first, second] = clean(offers, 'jobijoba');
    expect(first).toMatchObject({
      externalId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      title: 'Accountant / Comptable H/F',
      company: 'Exemple SA',
      location: 'Gand',
      postedAt: '2026-11-23',
      url: 'https://www.jobijoba.be/annonce/67/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(first!.description).toContain('de la facturation aux paiements.');
    expect(second).toMatchObject({
      company: '?',
      location: 'Bruxelles',
      postedAt: '2026-11-20',
      url: 'https://www.jobijoba.be/annonce/12/cccccccccccccccccccccccccccccccc',
    });
    expect(offers).toHaveLength(2);
  });

  it('follows a redirect within its own host only', async () => {
    const net = fakeNetwork((url) =>
      url.pathname === '/emploi/offres-emploi-Dessinateur.html'
        ? new Response(null, {
            status: 301,
            headers: { location: '/emploi/offres-emploi-Dessinateur-projeteur.html' },
          })
        : html(fixtureText('jobijoba-page.html')),
    );
    const result = await runConnector(jobijobaConnector, {
      fetch: net.fetch,
      keywords: ['dessinateur'],
    });
    expect(result.error).toBeNull();
    expect(net.calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/emploi/offres-emploi-Dessinateur.html',
      '/emploi/offres-emploi-Dessinateur-projeteur.html',
    ]);
    const away = fakeNetwork(
      () =>
        new Response(null, { status: 302, headers: { location: 'https://tracker.example.net/x' } }),
    );
    const refused = await runConnector(jobijobaConnector, { fetch: away.fetch });
    expect(refused.error).toMatchObject({ code: 'host_not_allowed' });
    expect(away.calls).toHaveLength(1);
  });
});

describe('Talent.com', () => {
  it('asks with the city of the search centre', async () => {
    const net = fakeNetwork(() => html(fixtureText('talent-page.html')));
    await runConnector(talentConnector, { fetch: net.fetch });
    expect(net.calls[0]!.url).toBe('https://be.talent.com/jobs?k=comptable&l=Bruxelles&p=1');
  });

  it('reads each card once, dates it from dateTime, links it by its view id', async () => {
    const net = fakeNetwork(() => html(fixtureText('talent-page.html')));
    const { offers, read } = await runConnector(talentConnector, {
      fetch: net.fetch,
      maxAgeDays: 60,
    });
    expect(read).toBe(3);
    const [first, second] = clean(offers, 'talent');
    expect(first).toMatchObject({
      externalId: '100000000000000001',
      title: 'Comptable',
      company: 'EXEMPLE',
      location: 'Huizingen, BE',
      postedAt: '2026-11-17',
      url: 'https://be.talent.com/view?id=100000000000000001',
      description: "Le comptable fictif tient les comptes d'une société exemplaire...",
    });
    // The card of the older template, right after its marker.
    expect(second).toMatchObject({
      externalId: '100000000000000003',
      title: 'Aide-comptable',
      company: '?',
      postedAt: '2026-11-20',
    });
    // The ad of May 2025 is read, not kept.
    expect(offers).toHaveLength(2);
  });
});

describe('Jobrapido', () => {
  it('asks without any place', () => {
    expect(jobrapidoUrl('aide comptable', 2)).toBe(
      'https://be.jobrapido.com/?w=aide%20comptable&p=2',
    );
  });

  it('reads the data of each result, one half of a title written twice', async () => {
    const net = fakeNetwork(() => html(fixtureText('jobrapido-page.html')));
    const { offers, read } = await runConnector(jobrapidoConnector, { fetch: net.fetch });
    // The unreadable result is counted as read, never kept.
    expect(read).toBe(3);
    const [first, second] = clean(offers, 'jobrapido');
    expect(first).toMatchObject({
      externalId: '1000000000000000001',
      title: 'Comptable Général - Luxembourg',
      company: 'Exemple Recrutement',
      location: 'Luxembourg',
      postedAt: '2026-11-16',
      url: 'https://be.jobrapido.com/jobpreview/1000000000000000001?redirectTo=https%253A%252F%252Fexample.org%252Fjob%252F1&w=comptable&p=1',
    });
    expect(second).toMatchObject({
      title: 'Comptable client (FR/NL) - secteur fictif',
      location: 'België',
      postedAt: '2026-10-15',
      salary: '3 000 € par mois',
    });
    expect(offers).toHaveLength(2);
  });

  it('keeps a title that is not written twice', () => {
    expect(oneHalf('Office Assistant Office Assistant')).toBe('Office Assistant');
    expect(oneHalf('Comptable Comptable - secteur de la construction')).toBe(
      'Comptable Comptable - secteur de la construction',
    );
  });
});
