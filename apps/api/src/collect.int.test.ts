import { type Connector, DEDUP_VERSION, identify } from '@job4me/collect';
import type {
  CollectionPass,
  ManualOfferResponse,
  Offer,
  OffersResponse,
  OfferUnmergeResponse,
  SourceSummary,
  SourcesResponse,
} from '@job4me/contracts';
import { and, eq, schema, type Transaction, withUser } from '@job4me/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CliError } from './cli/commands';
import { formatPass, sourcesPass } from './cli/sources';
import { createTestApp } from './testing/app';
import { signedInBrowser } from './testing/session';

// Sources and offers from the API side (phase 2 plan, section 8): it queues passes for the
// worker, shows their log, and stores manual offers without ever opening their link.

const connector = (name: string, extra: Partial<Connector> = {}): Connector => ({
  name,
  access: 'api',
  family: 'keywords',
  keywordLevel: 'full',
  personalUseOnly: false,
  titleFilter: false,
  hosts: ['api.example.org'],
  secrets: [],
  run: () => Promise.resolve(),
  ...extra,
});

const queued: { name: string; data: Record<string, unknown> }[] = [];
let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp({
    queue: {
      send: (name, data) => {
        queued.push({ name, data });
        return Promise.resolve('job');
      },
    },
    connectors: [
      connector('alpha'),
      connector('pages', { access: 'public_page', personalUseOnly: true }),
    ],
  });
  const source = {
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    pauseMs: 0,
    budgetMs: 60_000,
    retries: 0,
    maxPages: 1,
    cooldownHoursAfterBlock: 0,
    enabledByDefault: true,
  };
  const { collect } = ctx.deps.config.settings;
  collect.sources = { ...collect.sources, alpha: source, pages: { ...source, weekdays: [2, 5] } };
});

afterAll(async () => {
  await ctx?.close();
});

afterEach(() => {
  ctx.deps.config.settings.collect.usageMode = 'personal';
  vi.restoreAllMocks();
});

/** Plays the worker: one announcement with its postings, the first one retained. */
async function collected(
  tx: Transaction,
  userId: string,
  ...postings: Array<{
    source: string;
    externalId: string;
    title: string;
    company?: string;
    seen?: Date;
    mergeReason?: 'key' | 'employer';
  }>
) {
  const seen = postings[0]!.seen ?? new Date();
  const [offer] = await tx
    .insert(schema.offers)
    .values({ userId, firstSeenAt: seen, lastSeenAt: seen })
    .returning();
  const rows = await tx
    .insert(schema.jobOffers)
    .values(
      postings.map((posting) => ({
        userId,
        offerId: offer!.id,
        source: posting.source,
        externalId: posting.externalId,
        title: posting.title,
        company: posting.company ?? '?',
        ...(({ key, bare, refs }) => ({
          contentKey: key,
          bareTitle: bare,
          titleRefs: refs,
          dedupVersion: DEDUP_VERSION,
        }))(identify(posting.title, posting.company ?? '?')),
        url: `https://jobs.example.org/${posting.source}/${posting.externalId}`,
        mergeReason: posting.mergeReason ?? null,
        firstSeenAt: posting.seen ?? seen,
        lastSeenAt: posting.seen ?? seen,
      })),
    )
    .returning();
  await tx
    .update(schema.offers)
    .set({ retainedId: rows[0]!.id })
    .where(eq(schema.offers.id, offer!.id));
  return { offerId: offer!.id, postingIds: rows.map((row) => row.id) };
}

/** Plays the worker: closes the pass with one successful run per source. */
async function finish(userId: string, passId: string, trigger: string) {
  await withUser(ctx.deps.db, userId, async (tx) => {
    const [pass] = await tx
      .select()
      .from(schema.collectionPasses)
      .where(eq(schema.collectionPasses.id, passId));
    for (const source of pass!.sources) {
      await tx.insert(schema.sourceRuns).values({
        userId,
        passId,
        source,
        trigger,
        status: 'succeeded',
        readCount: 12,
        keptCount: 9,
        newCount: 4,
        requestCount: 2,
        durationMs: 1500,
        startedAt: new Date(),
        finishedAt: new Date(),
      });
    }
    await tx
      .update(schema.collectionPasses)
      .set({ status: 'done', finishedAt: new Date() })
      .where(eq(schema.collectionPasses.id, passId));
  });
}

describe('sources', () => {
  it('list every source of this machine with its switch, access and usage', async () => {
    const { browser } = await signedInBrowser(ctx, 'sources-list');
    const response = await browser.get('/api/sources');
    expect(response.statusCode).toBe(200);
    const body = response.json<SourcesResponse>();
    expect(body.usageMode).toBe('personal');
    expect(body.sources.map((source) => source.name)).toEqual(['alpha', 'pages']);
    expect(body.sources[1]).toMatchObject({
      access: 'public_page',
      personalUseOnly: true,
      enabled: true,
      locked: false,
      weekdays: [2, 5],
      cooldownUntil: null,
      runs: [],
    });
  });

  it('switch a source off and on, with an audit entry, for the signed-in account only', async () => {
    const alice = await signedInBrowser(ctx, 'switch-alice');
    const bob = await signedInBrowser(ctx, 'switch-bob');
    const off = await alice.browser.send('PATCH', '/api/sources/alpha', { enabled: false });
    expect(off.statusCode).toBe(200);
    expect(off.json<SourceSummary>()).toMatchObject({ name: 'alpha', enabled: false });
    const mine = (await alice.browser.get('/api/sources')).json<SourcesResponse>();
    expect(mine.sources[0]!.enabled).toBe(false);
    const theirs = (await bob.browser.get('/api/sources')).json<SourcesResponse>();
    expect(theirs.sources[0]!.enabled).toBe(true);
    const audit = await ctx.deps.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.actorUserId, alice.userId),
          eq(schema.auditLog.action, 'source.switched'),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toEqual({ enabled: false });

    const unknown = await alice.browser.send('PATCH', '/api/sources/nowhere', { enabled: true });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: 'source_unknown' });
  });

  it('cannot switch on a personal-use source in commercial mode (ADR 0014)', async () => {
    const { browser } = await signedInBrowser(ctx, 'commercial');
    ctx.deps.config.settings.collect.usageMode = 'commercial';
    const listed = (await browser.get('/api/sources')).json<SourcesResponse>();
    expect(listed.usageMode).toBe('commercial');
    expect(listed.sources.find((source) => source.name === 'pages')).toMatchObject({
      enabled: false,
      locked: true,
    });
    const refused = await browser.send('PATCH', '/api/sources/pages', { enabled: true });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'source_commercial_mode' });
    // Switching it off stays possible.
    expect((await browser.send('PATCH', '/api/sources/pages', { enabled: false })).statusCode).toBe(
      200,
    );
  });

  it('queue one test pass at a time for the worker, then show its log', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'test-pass');
    const before = queued.length;
    const first = await browser.post('/api/sources/test', {});
    expect(first.statusCode).toBe(200);
    const pass = first.json<CollectionPass>();
    expect(pass).toMatchObject({ trigger: 'test', status: 'queued', sources: ['alpha', 'pages'] });
    expect(queued.slice(before)).toEqual([
      { name: 'collect_pass', data: { userId, passId: pass.id } },
    ]);
    const again = (await browser.post('/api/sources/test', {})).json<CollectionPass>();
    expect(again.id).toBe(pass.id);
    expect(queued.length).toBe(before + 1);

    await finish(userId, pass.id, 'test');
    const latest = (await browser.get('/api/sources/test')).json<{ pass: CollectionPass }>();
    expect(latest.pass).toMatchObject({ id: pass.id, status: 'done' });
    expect(latest.pass.runs.map((run) => [run.source, run.readCount, run.newCount])).toEqual([
      ['alpha', 12, 4],
      ['pages', 12, 4],
    ]);
    const runs = (await browser.get('/api/sources/alpha/runs?limit=5')).json<{
      runs: unknown[];
    }>();
    expect(runs.runs).toHaveLength(1);
    const listed = (await browser.get('/api/sources')).json<SourcesResponse>();
    expect(listed.sources[0]!.runs[0]).toMatchObject({ trigger: 'test', keptCount: 9 });
  });

  it('test only the sources asked for, and refuse unknown ones', async () => {
    const { browser } = await signedInBrowser(ctx, 'test-some');
    const some = await browser.post('/api/sources/test', { sources: ['pages'] });
    expect(some.json<CollectionPass>().sources).toEqual(['pages']);
    const { browser: other } = await signedInBrowser(ctx, 'test-unknown');
    const unknown = await other.post('/api/sources/test', { sources: ['alpha', 'nowhere'] });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ error: 'source_unknown' });
  });

  it('never show a pass or a run to another account', async () => {
    const alice = await signedInBrowser(ctx, 'runs-alice');
    const bob = await signedInBrowser(ctx, 'runs-bob');
    const pass = (await alice.browser.post('/api/sources/test', {})).json<CollectionPass>();
    await finish(alice.userId, pass.id, 'test');
    expect((await bob.browser.get('/api/sources/test')).json()).toEqual({ pass: null });
    const runs = (await bob.browser.get('/api/sources/alpha/runs')).json<{ runs: unknown[] }>();
    expect(runs.runs).toEqual([]);
    const listed = (await bob.browser.get('/api/sources')).json<SourcesResponse>();
    expect(listed.sources.every((source) => source.runs.length === 0)).toBe(true);
  });

  it('show the alert, the quota and four weeks of scheduled runs, tests apart', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'window');
    const day = (count: number) => new Date(Date.now() - count * 86_400_000);
    await withUser(ctx.deps.db, userId, async (tx) => {
      await tx.insert(schema.sourceSettings).values({
        userId,
        source: 'alpha',
        alert: 'collapse',
        alertSince: day(1),
        alertRead: 3,
        alertUsual: 40,
        quotaRemaining: 120,
        quotaCheckedAt: day(1),
      });
      const [pass] = await tx
        .insert(schema.collectionPasses)
        .values({ userId, trigger: 'scheduled', status: 'done', sources: ['alpha'] })
        .returning();
      const run = (trigger: string, status: string, read: number, at: Date) => ({
        userId,
        passId: pass!.id,
        source: 'alpha',
        trigger,
        status,
        readCount: read,
        keptCount: Math.floor(read / 2),
        newCount: Math.floor(read / 4),
        createdAt: at,
      });
      await tx.insert(schema.sourceRuns).values([
        run('scheduled', 'succeeded', 40, day(10)),
        run('manual', 'failed', 0, day(5)),
        run('scheduled', 'succeeded', 3, day(1)),
        // Outside the window, or a test: not counted.
        run('scheduled', 'succeeded', 100, day(40)),
        run('test', 'succeeded', 9, day(1)),
        { ...run('scheduled', 'skipped', 0, day(2)), skipReason: 'disabled' },
      ]);
    });
    const listed = (await browser.get('/api/sources')).json<SourcesResponse>();
    const alpha = listed.sources.find((source) => source.name === 'alpha')!;
    expect(alpha.alert).toMatchObject({ kind: 'collapse', read: 3, usual: 40 });
    expect(alpha.quota).toMatchObject({ remaining: 120 });
    expect(alpha.window).toEqual({
      days: 28,
      runs: 3,
      failed: 1,
      read: 43,
      kept: 21,
      fresh: 10,
      merged: 0,
    });
    const other = listed.sources.find((source) => source.name === 'pages')!;
    expect(other).toMatchObject({ alert: null, quota: null });
    expect(other.window.runs).toBe(0);
  });

  it('need a session', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/sources' });
    expect(response.statusCode).toBe(401);
  });
});

describe('offers', () => {
  it('add an offer by hand without ever opening its link (threat 1)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { browser, userId } = await signedInBrowser(ctx, 'manual');
    const response = await browser.post('/api/offers', {
      title: '  Gestionnaire de dossiers  ',
      url: 'https://jobs.example.org/offre/42',
      text: 'Texte collé de l’annonce.',
    });
    expect(response.statusCode).toBe(200);
    const added = response.json<ManualOfferResponse>();
    expect(added.merged).toBe(false);
    expect(added.offer).toMatchObject({
      title: 'Gestionnaire de dossiers',
      company: '?',
      location: '?',
      url: 'https://jobs.example.org/offre/42',
      description: 'Texte collé de l’annonce.',
    });
    expect(added.offer.postings).toEqual([
      expect.objectContaining({ source: 'manual', origin: 'manual', mergeReason: null }),
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    const audit = await ctx.deps.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.actorUserId, userId), eq(schema.auditLog.action, 'offer.added')),
      );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.metadata)).not.toContain('Gestionnaire');

    const twice = await browser.post('/api/offers', {
      title: 'Again',
      url: 'https://jobs.example.org/offre/42',
    });
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toMatchObject({ error: 'duplicate' });
  });

  it('refuse links other than http and https, and texts beyond the cap', async () => {
    const { browser } = await signedInBrowser(ctx, 'manual-refused');
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.org/a', 'x']) {
      const response = await browser.post('/api/offers', { title: 'Offre', url });
      expect(response.statusCode).toBe(400);
    }
    const long = 'a'.repeat(ctx.deps.config.settings.collect.manual.maxTextChars + 1);
    expect((await browser.post('/api/offers', { title: 'Offre', text: long })).statusCode).toBe(
      400,
    );
    expect((await browser.post('/api/offers', { title: '' })).statusCode).toBe(400);
    // Without a link, two offers with the same title are two offers: two offers added by hand
    // are never merged together.
    const first = await browser.post('/api/offers', { title: 'Sans lien' });
    const second = await browser.post('/api/offers', { title: 'Sans lien' });
    expect(second.statusCode).toBe(200);
    expect(second.json<ManualOfferResponse>().merged).toBe(false);
    expect(second.json<ManualOfferResponse>().offer.id).not.toBe(
      first.json<ManualOfferResponse>().offer.id,
    );
  });

  it('list the offers of the account, newest first, by source and page by page', async () => {
    const alice = await signedInBrowser(ctx, 'list-alice');
    const bob = await signedInBrowser(ctx, 'list-bob');
    const day = (count: number) => new Date(Date.now() - count * 86_400_000);
    await withUser(ctx.deps.db, alice.userId, async (tx) => {
      for (const age of [3, 2, 1]) {
        await collected(tx, alice.userId, {
          source: 'alpha',
          externalId: `a-${age}`,
          title: `<script>alert(${age})</script> Offre ${age}`,
          seen: day(age),
        });
      }
    });
    await alice.browser.post('/api/offers', { title: 'Manuelle' });

    const all = (await alice.browser.get('/api/offers')).json<OffersResponse>();
    expect(all.offers.map((offer) => offer.title)).toEqual([
      'Manuelle',
      '<script>alert(1)</script> Offre 1',
      '<script>alert(2)</script> Offre 2',
      '<script>alert(3)</script> Offre 3',
    ]);
    expect(all.nextCursor).toBeNull();

    const alpha = (
      await alice.browser.get('/api/offers?source=alpha&limit=2')
    ).json<OffersResponse>();
    expect(alpha.offers.map((offer) => offer.title.slice(-7))).toEqual(['Offre 1', 'Offre 2']);
    const next = (
      await alice.browser.get(`/api/offers?source=alpha&limit=2&before=${alpha.nextCursor}`)
    ).json<OffersResponse>();
    expect(next.offers.map((offer) => offer.title.slice(-7))).toEqual(['Offre 3']);
    expect(next.nextCursor).toBeNull();

    expect((await bob.browser.get('/api/offers')).json<OffersResponse>().offers).toEqual([]);
    // Another account's cursor is unknown here.
    const foreign = await bob.browser.get(`/api/offers?before=${all.offers[0]!.id}`);
    expect(foreign.statusCode).toBe(400);
  });

  it('list an announcement once with every posting, and filter by any of its sources', async () => {
    const alice = await signedInBrowser(ctx, 'merged-alice');
    const bob = await signedInBrowser(ctx, 'merged-bob');
    const { offerId } = await withUser(ctx.deps.db, alice.userId, (tx) =>
      collected(
        tx,
        alice.userId,
        { source: 'alpha', externalId: 'x1', title: 'Comptable', company: 'Exemple' },
        {
          source: 'pages',
          externalId: 'p1',
          title: 'Comptable (H/F)',
          company: 'Exemple SA',
          mergeReason: 'key',
        },
      ),
    );
    const list = (await alice.browser.get('/api/offers')).json<OffersResponse>();
    expect(list.offers).toHaveLength(1);
    expect(list.offers[0]).toMatchObject({ id: offerId, title: 'Comptable', company: 'Exemple' });
    expect(
      list.offers[0]!.postings.map((posting) => [posting.source, posting.mergeReason]),
    ).toEqual([
      ['alpha', null],
      ['pages', 'key'],
    ]);
    for (const source of ['alpha', 'pages']) {
      const filtered = (
        await alice.browser.get(`/api/offers?source=${source}`)
      ).json<OffersResponse>();
      expect(filtered.offers.map((offer) => offer.id)).toEqual([offerId]);
    }

    const page = await alice.browser.get(`/api/offers/${offerId}`);
    expect(page.statusCode).toBe(200);
    expect(page.json<Offer>().postings).toHaveLength(2);
    expect((await bob.browser.get(`/api/offers/${offerId}`)).statusCode).toBe(404);
    expect(
      (await alice.browser.get('/api/offers/00000000-0000-7000-8000-000000000000')).statusCode,
    ).toBe(404);
  });

  it("undo a merge from the offer's page, for its own account only", async () => {
    const alice = await signedInBrowser(ctx, 'unmerge-alice');
    const bob = await signedInBrowser(ctx, 'unmerge-bob');
    const { offerId, postingIds } = await withUser(ctx.deps.db, alice.userId, (tx) =>
      collected(
        tx,
        alice.userId,
        { source: 'alpha', externalId: 'u1', title: 'Juriste', company: 'Exemple' },
        {
          source: 'pages',
          externalId: 'u2',
          title: 'Juriste',
          company: 'Exemple Brussels',
          mergeReason: 'employer',
        },
      ),
    );
    const [alphaPosting, pagesPosting] = postingIds;
    const url = `/api/offers/${offerId}/unmerge`;
    expect((await bob.browser.post(url, { postingId: pagesPosting })).statusCode).toBe(404);
    expect(
      (await alice.browser.post(url, { postingId: '00000000-0000-7000-8000-000000000000' }))
        .statusCode,
    ).toBe(404);

    const response = await alice.browser.post(url, { postingId: pagesPosting });
    expect(response.statusCode).toBe(200);
    const { offer, detached } = response.json<OfferUnmergeResponse>();
    expect(offer.postings.map((posting) => posting.id)).toEqual([alphaPosting]);
    expect(detached.id).not.toBe(offerId);
    expect(detached).toMatchObject({ title: 'Juriste', company: 'Exemple Brussels' });
    expect(detached.postings).toEqual([
      expect.objectContaining({ id: pagesPosting, source: 'pages', mergeReason: null }),
    ]);
    const audit = await ctx.deps.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.actorUserId, alice.userId),
          eq(schema.auditLog.action, 'offer.unmerged'),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ targetType: 'offer', targetId: offerId });

    // An announcement with one posting has nothing to undo.
    const alone = await alice.browser.post(url, { postingId: alphaPosting });
    expect(alone.statusCode).toBe(409);
    expect(alone.json()).toMatchObject({ error: 'offer_not_merged' });
    expect((await alice.browser.get('/api/offers')).json<OffersResponse>().offers).toHaveLength(2);
  });

  it('join an offer added by hand to the announcement already collected', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'manual-merged');
    const { offerId } = await withUser(ctx.deps.db, userId, (tx) =>
      collected(tx, userId, {
        source: 'alpha',
        externalId: 'm1',
        title: 'Juriste - Bruxelles',
        company: 'Exemple',
      }),
    );
    const response = await browser.post('/api/offers', {
      title: 'Juriste (H/F/X)',
      company: 'Exemple SA',
      text: 'Texte collé de l’annonce, plus complet que celui de la source.',
    });
    expect(response.statusCode).toBe(200);
    const added = response.json<ManualOfferResponse>();
    expect(added.merged).toBe(true);
    expect(added.offer.id).toBe(offerId);
    // The posting with the longest description is the one shown.
    expect(added.offer).toMatchObject({ title: 'Juriste (H/F/X)', company: 'Exemple SA' });
    expect(added.offer.postings.map((posting) => [posting.source, posting.mergeReason])).toEqual([
      ['manual', 'key'],
      ['alpha', null],
    ]);
  });

  it('place an offer added by hand and measure it from the base city (ADR 0017)', async () => {
    const { browser } = await signedInBrowser(ctx, 'manual-placed');
    await browser.send('PATCH', '/api/profile', { baseCity: 'Bruxelles', basePostalCode: '1000' });
    const response = await browser.post('/api/offers', {
      title: 'Gestionnaire de paie',
      location: 'Malines',
      text: 'Poste en 100 % télétravail.',
    });
    expect(response.statusCode).toBe(200);
    const { offer } = response.json<ManualOfferResponse>();
    expect(offer.place).toEqual({
      status: 'found',
      name: 'Mechelen',
      postalCode: '2800',
      distanceKm: 27,
    });
    expect(offer.remote).toBe('full');
    expect(offer.postings[0]!.place).toEqual({
      status: 'found',
      name: 'Mechelen',
      postalCode: '2800',
    });
    const abroad = (
      await browser.post('/api/offers', { title: 'Acheteur', location: 'Montrouge, France' })
    ).json<ManualOfferResponse>();
    expect(abroad.offer.place).toEqual({
      status: 'abroad',
      name: null,
      postalCode: null,
      distanceKm: null,
    });
  });

  it('measure every distance again when the base city changes', async () => {
    const { browser } = await signedInBrowser(ctx, 'base-moved');
    await browser.send('PATCH', '/api/profile', { baseCity: 'Bruxelles' });
    const { offer } = (
      await browser.post('/api/offers', { title: 'Comptable', location: '2800 Mechelen' })
    ).json<ManualOfferResponse>();
    expect(offer.place.distanceKm).toBe(27);
    await browser.send('PATCH', '/api/profile', { baseCity: 'Mechelen' });
    expect((await browser.get(`/api/offers/${offer.id}`)).json<Offer>().place.distanceKm).toBe(0);
    await browser.send('PATCH', '/api/profile', { baseCity: 'Nulle part' });
    expect(
      (await browser.get(`/api/offers/${offer.id}`)).json<Offer>().place.distanceKm,
    ).toBeNull();
  });

  it('list the offers the filter keeps or sets aside, with their counts', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'filter-views');
    const kept = await withUser(ctx.deps.db, userId, (tx) =>
      collected(tx, userId, { source: 'alpha', externalId: 'k1', title: 'Comptable' }),
    );
    const aside = await withUser(ctx.deps.db, userId, async (tx) => {
      const made = await collected(tx, userId, {
        source: 'alpha',
        externalId: 'x1',
        title: 'Juriste',
        company: 'Deloitte',
      });
      await tx
        .update(schema.offers)
        .set({ excludedReason: 'excluded_company' })
        .where(eq(schema.offers.id, made.offerId));
      return made;
    });
    const list = (await browser.get('/api/offers')).json<OffersResponse>();
    expect(list.offers.map((offer) => offer.id)).toEqual([kept.offerId]);
    expect(list.counts).toEqual({ kept: 1, excluded: 1 });
    const excluded = (await browser.get('/api/offers?view=excluded')).json<OffersResponse>();
    expect(excluded.offers).toEqual([
      expect.objectContaining({ id: aside.offerId, excluded: 'excluded_company' }),
    ]);
    expect((await browser.get('/api/offers?view=other')).statusCode).toBe(400);
  });

  it('ask the worker to screen again when a criterion of the filter changes', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'filter-criteria');
    const screens = () =>
      queued.filter((job) => job.name === 'offers_screen' && job.data.userId === userId).length;
    await browser.send('PATCH', '/api/profile', { motivations: 'Aider les PME.' });
    expect(screens()).toBe(0);
    await browser.send('PATCH', '/api/profile', { radiusKm: 25 });
    expect(screens()).toBe(1);
    await browser.post('/api/profile/excluded-companies', { name: 'Deloitte' });
    expect(screens()).toBe(2);
    await browser.post('/api/profile/eliminations', { kind: 'language', value: 'Allemand' });
    expect(screens()).toBe(3);
    // An offer added by hand is kept, whatever the criteria.
    const added = (
      await browser.post('/api/offers', { title: 'Juriste', company: 'Deloitte' })
    ).json<ManualOfferResponse>();
    expect(added.offer.excluded).toBeNull();
  });
});

describe('command line', () => {
  const fakes = [connector('alpha'), connector('pages', { personalUseOnly: true })];

  it('queues a pass, follows it until the worker is done and prints its log', async () => {
    const { userId } = await signedInBrowser(ctx, 'cli');
    const [user] = await ctx.deps.db.select().from(schema.users).where(eq(schema.users.id, userId));
    const printed: string[] = [];
    const sent: string[] = [];
    const pass = await sourcesPass(ctx.deps.db, ctx.deps.config, {
      trigger: 'test',
      email: user!.email,
      connectors: fakes,
      queue: {
        send: async (name, data) => {
          sent.push(name);
          // Plays the worker, a little later.
          setTimeout(() => void finish(String(data.userId), String(data.passId), 'test'), 30);
          return 'job';
        },
      },
      pollMs: 10,
      print: (line) => printed.push(line),
    });
    expect(sent).toEqual(['collect_pass']);
    expect(pass.status).toBe('done');
    expect(printed[0]).toBe('Test des sources lancé : alpha, pages. En attente du worker…');
    expect(printed[1]).toMatch(/alpha\s+réussie\s+12\s+9\s+4\s+0\s+1,5 s/);
  });

  it('names the sources of the machine when one asked for is unknown', async () => {
    const { userId } = await signedInBrowser(ctx, 'cli-unknown');
    const [user] = await ctx.deps.db.select().from(schema.users).where(eq(schema.users.id, userId));
    const error = await sourcesPass(ctx.deps.db, ctx.deps.config, {
      trigger: 'manual',
      email: user!.email,
      sources: ['nowhere'],
      connectors: fakes,
      queue: { send: () => Promise.resolve('job') },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toBe(
      'Source inconnue. Sources de cette machine : alpha, pages.',
    );
  });

  it('formats a pass as one line per source', () => {
    const text = formatPass({
      id: '00000000-0000-7000-8000-000000000000',
      trigger: 'test',
      status: 'done',
      sources: ['alpha', 'pages'],
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      runs: [
        {
          id: '00000000-0000-7000-8000-000000000001',
          passId: '00000000-0000-7000-8000-000000000000',
          source: 'alpha',
          trigger: 'test',
          status: 'failed',
          skipReason: null,
          errorCode: 'blocked',
          httpStatus: 429,
          readCount: 0,
          keptCount: 0,
          newCount: 0,
          mergedCount: 0,
          invalidCount: 0,
          requestCount: 1,
          durationMs: 820,
          startedAt: null,
          finishedAt: null,
        },
        {
          id: '00000000-0000-7000-8000-000000000002',
          passId: '00000000-0000-7000-8000-000000000000',
          source: 'pages',
          trigger: 'test',
          status: 'skipped',
          skipReason: 'disabled',
          errorCode: null,
          httpStatus: null,
          readCount: 0,
          keptCount: 0,
          newCount: 0,
          mergedCount: 0,
          invalidCount: 0,
          requestCount: 0,
          durationMs: 0,
          startedAt: null,
          finishedAt: null,
        },
      ],
    });
    const lines = text.split('\n');
    expect(lines[0]).toMatch(
      /^Source\s+Statut\s+Lues\s+Retenues\s+Inédites\s+Fusionnées\s+Durée\s+Détail$/,
    );
    expect(lines[1]).toMatch(
      /^alpha\s+en échec\s+0\s+0\s+0\s+0\s+0,8 s\s+refusée par le site \(HTTP 429\)$/,
    );
    expect(lines[2]).toMatch(/^pages\s+sautée\s+-\s+-\s+-\s+-\s+-\s+interrupteur coupé$/);
  });
});
