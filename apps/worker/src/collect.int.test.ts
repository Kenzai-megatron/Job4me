import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import {
  availableConnectors,
  type Connector,
  eachKeyword,
  Gazetteer,
  SourceSkipped,
} from '@job4me/collect';
import { loadConfig, type Settings } from '@job4me/config';
import { connect, type DatabaseHandle, eq, readLocalities, schema, withUser } from '@job4me/db';
import { createTestDatabase, type TestDatabase } from '@job4me/db/testing';
import { createLogger } from '@job4me/logger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { judgeRun } from './collect/alerts';
import { closeStalePasses, type CollectDeps, keywordsFor, runPass } from './collect/pass';
import { prepareStoredPostings } from './collect/postings';
import { screenOffers, screenProfileOf } from './collect/screen';
import { dueSources, isoWeekday, purgeCollection, schedulePasses } from './collect/schedule';

let database: TestDatabase;
let handle: DatabaseHandle;
let settings: Settings;
let gazetteer: Gazetteer;

const lines: string[] = [];
const logger = createLogger({
  name: 'test',
  level: 'debug',
  destination: new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString('utf8'));
      done();
    },
  }),
});

const source = {
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  pauseMs: 0,
  budgetMs: 5000,
  retries: 0,
  maxPages: 2,
  cooldownHoursAfterBlock: 0,
  enabledByDefault: true,
};

beforeAll(async () => {
  database = await createTestDatabase('collect');
  handle = connect(database.appUrl, { max: 3 });
  const loaded = structuredClone(loadConfig().settings);
  loaded.collect.demoSource = true;
  loaded.collect.sources = {
    ...loaded.collect.sources,
    alpha: source,
    beta: source,
    gamma: { ...source, budgetMs: 300 },
    linked: { ...source, cooldownHoursAfterBlock: 24, weekdays: [2, 5] },
    keyed: source,
    pages: source,
    off: { ...source, enabledByDefault: false },
  };
  settings = loaded;
  gazetteer = new Gazetteer(await readLocalities(handle.db), settings.geo);
});

afterAll(async () => {
  await handle?.close();
  await database?.drop();
});

async function account(keywords: Array<[string, boolean]> = [['comptable', true]]) {
  const [user] = await handle.db
    .insert(schema.users)
    .values({
      email: `collect-${randomBytes(4).toString('hex')}@example.org`,
      displayName: 'C',
      webauthnUserHandle: randomBytes(32),
    })
    .returning();
  const userId = user!.id;
  if (keywords.length > 0) {
    await withUser(handle.db, userId, (tx) =>
      tx.insert(schema.searchKeywords).values(
        keywords.map(([keyword, priority]) => ({
          userId,
          keyword,
          priority,
          language: 'fr',
          status: 'validated',
        })),
      ),
    );
  }
  return userId;
}

async function pass(userId: string, sources: string[], trigger = 'manual') {
  const [row] = await withUser(handle.db, userId, (tx) =>
    tx
      .insert(schema.collectionPasses)
      .values({ userId, trigger, sources })
      .returning({ id: schema.collectionPasses.id }),
  );
  return row!.id;
}

function runsOf(userId: string, passId: string) {
  return withUser(handle.db, userId, (tx) =>
    tx
      .select()
      .from(schema.sourceRuns)
      .where(eq(schema.sourceRuns.passId, passId))
      .orderBy(schema.sourceRuns.createdAt),
  );
}

function offersOf(userId: string) {
  return withUser(handle.db, userId, (tx) =>
    tx
      .select()
      .from(schema.jobOffers)
      .where(eq(schema.jobOffers.userId, userId))
      .orderBy(schema.jobOffers.firstSeenAt, schema.jobOffers.id),
  );
}

/** The announcements of an account, oldest first. */
function announcementsOf(userId: string) {
  return withUser(handle.db, userId, (tx) =>
    tx
      .select()
      .from(schema.offers)
      .where(eq(schema.offers.userId, userId))
      .orderBy(schema.offers.firstSeenAt, schema.offers.id),
  );
}

const connector = (overrides: Partial<Connector> & Pick<Connector, 'name' | 'run'>): Connector => ({
  access: 'api',
  family: 'keywords',
  keywordLevel: 'full',
  personalUseOnly: false,
  titleFilter: false,
  hosts: ['api.example.org'],
  secrets: [],
  ...overrides,
});

/** A connector reading one JSON page per keyword from the fake network. */
const reader = (name: string, extra: Partial<Connector> = {}) =>
  connector({
    name,
    ...extra,
    async run(context) {
      await eachKeyword(context, async (keyword) => {
        const page = await context.http.getJson(
          `https://api.example.org/${name}?q=${encodeURIComponent(keyword)}&app_key=s3cr3t-key`,
          z.object({ jobs: z.array(z.object({ id: z.string(), title: z.string() })) }),
        );
        context.add(
          page.jobs.map((job) => ({
            externalId: job.id,
            title: job.title,
            url: `https://jobs.example.org/${job.id}`,
          })),
        );
      });
    },
  });

const jobs = (...titles: string[]) =>
  new Response(
    JSON.stringify({ jobs: titles.map((title, index) => ({ id: `id-${index}`, title })) }),
    { headers: { 'content-type': 'application/json' } },
  );

function deps(connectors: Connector[], extra: Partial<CollectDeps> = {}): CollectDeps {
  return {
    db: handle.db,
    settings,
    logger,
    gazetteer,
    connectors,
    secrets: {},
    sleep: () => Promise.resolve(),
    ...extra,
  };
}

describe('a collection pass', () => {
  it('stores the offers with the log of the run, then counts only new ones', async () => {
    const userId = await account([
      ['comptable', true],
      ['aide-comptable', false],
    ]);
    const demo = availableConnectors(settings).find((item) => item.name === 'demo')!;
    const first = await pass(userId, ['demo']);
    const [outcome] = await runPass(deps([demo]), { userId, passId: first });
    expect(outcome).toMatchObject({ source: 'demo', status: 'succeeded', readCount: 3 });
    const offers = await offersOf(userId);
    expect(offers).toHaveLength(3);
    expect(offers[0]).toMatchObject({ source: 'demo', company: 'Exemple SA', origin: 'collected' });
    // The demo's third offer republishes the first, its employer written with the city.
    expect(await announcementsOf(userId)).toHaveLength(2);
    expect(offers.find((offer) => offer.externalId === 'demo-comptable-3')).toMatchObject({
      offerId: offers.find((offer) => offer.externalId === 'demo-comptable-1')!.offerId,
      mergeReason: 'employer',
    });

    const [run] = await runsOf(userId, first);
    expect(run).toMatchObject({
      status: 'succeeded',
      readCount: 3,
      keptCount: 3,
      newCount: 2,
      mergedCount: 1,
      invalidCount: 0,
      trigger: 'manual',
    });
    expect(run!.durationMs).toBeGreaterThanOrEqual(0);

    const second = await pass(userId, ['demo']);
    await runPass(deps([demo]), { userId, passId: second });
    const [again] = await runsOf(userId, second);
    expect(again).toMatchObject({ readCount: 3, keptCount: 3, newCount: 0, mergedCount: 0 });
    expect(await offersOf(userId)).toHaveLength(3);
    expect(await announcementsOf(userId)).toHaveLength(2);
    const [passRow] = await withUser(handle.db, userId, (tx) =>
      tx.select().from(schema.collectionPasses).where(eq(schema.collectionPasses.id, second)),
    );
    expect(passRow).toMatchObject({ status: 'done' });
    expect(passRow!.finishedAt).not.toBeNull();
  });

  it('in test mode, uses one keyword and one page, and writes its log but no offer', async () => {
    const userId = await account([
      ['comptable', true],
      ['fiscaliste', true],
    ]);
    const seen: Array<{ keywords: readonly string[]; maxPages: number }> = [];
    const spy = connector({
      name: 'alpha',
      run(context) {
        seen.push({ keywords: context.keywords, maxPages: context.maxPages });
        context.add([{ externalId: 'x', title: 'Comptable', url: 'https://jobs.example.org/x' }]);
        return Promise.resolve();
      },
    });
    const id = await pass(userId, ['alpha'], 'test');
    await runPass(deps([spy]), { userId, passId: id });
    expect(seen).toEqual([{ keywords: ['comptable'], maxPages: 1 }]);
    expect(await offersOf(userId)).toHaveLength(0);
    const [run] = await runsOf(userId, id);
    expect(run).toMatchObject({ trigger: 'test', status: 'succeeded', readCount: 1, newCount: 1 });
  });

  it('applies the title filter of the profile only to the sources that declare it', async () => {
    const userId = await account();
    await withUser(handle.db, userId, (tx) =>
      tx.insert(schema.titleFilterRules).values([
        { userId, list: 'keep', expression: 'comptab' },
        { userId, list: 'reject', expression: 'stage' },
      ]),
    );
    const net = () => jobs('Comptable', 'Stage comptable', 'Chauffeur');
    const filtered = reader('alpha', { titleFilter: true });
    const precise = reader('beta');
    const id = await pass(userId, ['alpha', 'beta']);
    const fetch = () => Promise.resolve(net());
    await runPass(deps([filtered, precise], { fetch }), { userId, passId: id });
    const [alpha, beta] = await runsOf(userId, id);
    expect(alpha).toMatchObject({ source: 'alpha', readCount: 3, keptCount: 1, newCount: 1 });
    // Beta's "Comptable" is alpha's announcement: merged, not new.
    expect(beta).toMatchObject({
      source: 'beta',
      readCount: 3,
      keptCount: 3,
      newCount: 2,
      mergedCount: 1,
    });
  });

  it('stops a source at the first 429, keeps the others going, and waits 24 h when asked', async () => {
    const userId = await account([
      ['comptable', true],
      ['fiscaliste', true],
    ]);
    const calls: string[] = [];
    const fetch = (url: string) => {
      calls.push(new URL(url).pathname);
      return Promise.resolve(
        url.includes('/linked') ? new Response('slow down', { status: 429 }) : jobs('Comptable'),
      );
    };
    const linked = reader('linked', { personalUseOnly: true, access: 'linkedin_guest' });
    const alpha = reader('alpha');
    const id = await pass(userId, ['linked', 'alpha']);
    const outcomes = await runPass(deps([linked, alpha], { fetch }), { userId, passId: id });
    expect(outcomes.map((outcome) => [outcome.source, outcome.status])).toEqual([
      ['linked', 'failed'],
      ['alpha', 'succeeded'],
    ]);
    // One request only: no retry, no second keyword.
    expect(calls.filter((path) => path === '/linked')).toHaveLength(1);
    const [blocked] = await runsOf(userId, id);
    expect(blocked).toMatchObject({ errorCode: 'blocked', httpStatus: 429, requestCount: 1 });

    const next = await pass(userId, ['linked', 'alpha']);
    await runPass(deps([linked, alpha], { fetch }), { userId, passId: next });
    const [skipped] = await runsOf(userId, next);
    expect(skipped).toMatchObject({ status: 'skipped', skipReason: 'cooldown' });
    expect(calls.filter((path) => path === '/linked')).toHaveLength(1);
  });

  it('skips with a reason: switch, default, commercial mode, missing key, no keyword', async () => {
    const userId = await account();
    const none = await account([]);
    await withUser(handle.db, userId, (tx) =>
      tx.insert(schema.sourceSettings).values({ userId, source: 'alpha', enabled: false }),
    );
    const sources = [
      reader('alpha'),
      reader('off'),
      reader('pages', { personalUseOnly: true, access: 'public_page' }),
      reader('keyed', { secrets: ['adzunaKey'] }),
    ];
    const commercial = structuredClone(settings);
    commercial.collect.usageMode = 'commercial';
    const id = await pass(userId, ['alpha', 'off', 'pages', 'keyed']);
    await runPass(deps(sources, { settings: commercial }), { userId, passId: id });
    expect((await runsOf(userId, id)).map((run) => [run.source, run.skipReason])).toEqual([
      ['alpha', 'disabled'],
      ['off', 'disabled'],
      ['pages', 'commercial_mode'],
      ['keyed', 'missing_key'],
    ]);

    const empty = await pass(none, ['beta']);
    await runPass(deps([reader('beta')]), { userId: none, passId: empty });
    expect((await runsOf(none, empty))[0]).toMatchObject({
      status: 'skipped',
      skipReason: 'no_keywords',
    });
  });

  it('gives a source its keys only when present, and never stores or logs them', async () => {
    const userId = await account();
    const keyed = connector({
      name: 'keyed',
      secrets: ['adzunaKey'],
      async run(context) {
        await context.http.getText(
          `https://api.example.org/search?app_key=${context.secrets.adzunaKey}&what=comptable`,
        );
      },
    });
    const id = await pass(userId, ['keyed']);
    lines.length = 0;
    const fetch = () => Promise.resolve(new Response('down', { status: 500 }));
    await runPass(deps([keyed], { fetch, secrets: { adzunaKey: 'k3y-v4lue' } }), {
      userId,
      passId: id,
    });
    const [run] = await runsOf(userId, id);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'http_error', httpStatus: 500 });
    expect(JSON.stringify(run)).not.toContain('k3y-v4lue');
    expect(lines.join('')).not.toContain('k3y-v4lue');
    expect(lines.join('')).toContain('app_key=[redacted]');
  });

  it('stores the quota a rationed source reports, and skips it under its reserve', async () => {
    const userId = await account();
    const rationed = connector({
      name: 'keyed',
      async run(context) {
        await context.http.getText('https://api.example.org/account.json');
        context.reportQuota(5);
        throw new SourceSkipped('quota');
      },
    });
    const id = await pass(userId, ['keyed']);
    const fetch = () => Promise.resolve(new Response('{}'));
    const [outcome] = await runPass(deps([rationed], { fetch }), { userId, passId: id });
    expect(outcome).toMatchObject({ status: 'skipped', skipReason: 'quota' });
    expect((await runsOf(userId, id))[0]).toMatchObject({
      status: 'skipped',
      skipReason: 'quota',
      requestCount: 1,
      readCount: 0,
    });
    const [setting] = await withUser(handle.db, userId, (tx) =>
      tx.select().from(schema.sourceSettings).where(eq(schema.sourceSettings.userId, userId)),
    );
    expect(setting).toMatchObject({ source: 'keyed', quotaRemaining: 5 });
    expect(setting!.quotaCheckedAt).not.toBeNull();
  });

  it('hands a source its age limit, its own parameters and the search centre', async () => {
    const userId = await account();
    const seen: unknown[] = [];
    const spy = connector({
      name: 'beta',
      run(context) {
        seen.push({ maxAgeDays: context.maxAgeDays, params: context.params, area: context.area });
        return Promise.resolve();
      },
    });
    const custom = structuredClone(settings);
    custom.collect.sources.beta = { ...source, maxAgeDays: 30, params: { pageSize: 10 } };
    const id = await pass(userId, ['beta']);
    await runPass(deps([spy], { settings: custom }), { userId, passId: id });
    expect(seen).toEqual([
      { maxAgeDays: 30, params: { pageSize: 10 }, area: settings.collect.area },
    ]);
  });

  it('keeps what a source read before failing, and isolates a broken or malformed one', async () => {
    const userId = await account([
      ['comptable', true],
      ['fiscaliste', true],
    ]);
    const partial = connector({
      name: 'alpha',
      run(context) {
        context.add([{ externalId: 'a', title: 'Comptable', url: 'https://jobs.example.org/a' }]);
        throw new Error('the page changed');
      },
    });
    const malformed = reader('beta');
    const sane = reader('pages');
    const fetch = (url: string) =>
      Promise.resolve(
        url.includes('/beta') ? new Response('<html>not json</html>') : jobs('Comptable'),
      );
    const id = await pass(userId, ['alpha', 'beta', 'pages']);
    await runPass(deps([partial, malformed, sane], { fetch }), { userId, passId: id });
    const [alpha, beta, pages] = await runsOf(userId, id);
    expect(alpha).toMatchObject({ status: 'partial', errorCode: 'connector_error', readCount: 1 });
    expect(beta).toMatchObject({ status: 'failed', errorCode: 'invalid_response', readCount: 0 });
    expect(pages).toMatchObject({ status: 'succeeded', readCount: 2 });
  });

  it('records one failing keyword out of several as a partial run', async () => {
    const userId = await account([
      ['comptable', true],
      ['fiscaliste', true],
    ]);
    const fetch = (url: string) =>
      Promise.resolve(
        url.includes('fiscaliste') ? new Response('oops', { status: 502 }) : jobs('Comptable'),
      );
    const id = await pass(userId, ['alpha']);
    await runPass(deps([reader('alpha')], { fetch }), { userId, passId: id });
    expect((await runsOf(userId, id))[0]).toMatchObject({
      status: 'partial',
      errorCode: 'http_error',
      httpStatus: 502,
      readCount: 1,
      requestCount: 2,
    });
  });

  it('respects the budget of a source that hangs, then runs the next one (threat 9)', async () => {
    const userId = await account();
    const hanging = connector({
      name: 'gamma',
      run: (context) => {
        context.add([{ externalId: 'h', title: 'Comptable', url: 'https://jobs.example.org/h' }]);
        return new Promise(() => undefined);
      },
    });
    const id = await pass(userId, ['gamma', 'alpha']);
    const started = Date.now();
    const fetch = () => Promise.resolve(jobs('Comptable'));
    await runPass(deps([hanging, reader('alpha')], { fetch }), { userId, passId: id });
    expect(Date.now() - started).toBeLessThan(3000);
    const [gamma, alpha] = await runsOf(userId, id);
    expect(gamma).toMatchObject({ status: 'partial', errorCode: 'budget_exceeded', readCount: 1 });
    expect(alpha).toMatchObject({ status: 'succeeded' });
  });

  it('refuses a redirect outside the declared hosts (threat 1)', async () => {
    const userId = await account();
    const fetch = () =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
      );
    const id = await pass(userId, ['alpha']);
    await runPass(deps([reader('alpha')], { fetch }), { userId, passId: id });
    expect((await runsOf(userId, id))[0]).toMatchObject({
      status: 'failed',
      errorCode: 'host_not_allowed',
      requestCount: 1,
    });
  });

  it('drops offers that do not fit the common format, and counts them', async () => {
    const userId = await account();
    const sloppy = connector({
      name: 'alpha',
      run(context) {
        context.add(
          [
            { externalId: 'ok', title: 'Comptable', url: 'https://jobs.example.org/ok' },
            { externalId: 'ok', title: 'Comptable (copie)', url: 'https://jobs.example.org/ok' },
            { externalId: 'js', title: '<b>x</b>', url: 'javascript:alert(1)' },
            { externalId: '', title: 'No id', url: 'https://jobs.example.org/none' },
          ],
          4,
        );
        return Promise.resolve();
      },
    });
    const id = await pass(userId, ['alpha']);
    await runPass(deps([sloppy]), { userId, passId: id });
    expect((await runsOf(userId, id))[0]).toMatchObject({
      readCount: 4,
      invalidCount: 2,
      keptCount: 1,
      newCount: 1,
    });
  });

  it('runs a pass only for its own account, once', async () => {
    const owner = await account();
    const stranger = await account();
    const id = await pass(owner, ['alpha']);
    const fetch = () => Promise.resolve(jobs('Comptable'));
    expect(
      await runPass(deps([reader('alpha')], { fetch }), { userId: stranger, passId: id }),
    ).toEqual([]);
    expect(await runsOf(owner, id)).toHaveLength(0);
    await runPass(deps([reader('alpha')], { fetch }), { userId: owner, passId: id });
    expect(
      await runPass(deps([reader('alpha')], { fetch }), { userId: owner, passId: id }),
    ).toEqual([]);
    expect(await runsOf(owner, id)).toHaveLength(1);
    expect(await offersOf(stranger)).toHaveLength(0);
    // Row-level security: even without the filter, the stranger sees nothing.
    const seen = await withUser(handle.db, stranger, (tx) => tx.select().from(schema.jobOffers));
    expect(seen.every((offer) => offer.userId === stranger)).toBe(true);
  });

  it('closes the passes a stopped worker left running', async () => {
    const userId = await account();
    const old = new Date(Date.now() - settings.collect.staleAfterMs - 60_000);
    const [stale] = await withUser(handle.db, userId, (tx) =>
      tx
        .insert(schema.collectionPasses)
        .values({
          userId,
          trigger: 'manual',
          status: 'running',
          sources: ['alpha'],
          createdAt: old,
        })
        .returning(),
    );
    await withUser(handle.db, userId, (tx) =>
      tx.insert(schema.sourceRuns).values({
        userId,
        passId: stale!.id,
        source: 'alpha',
        trigger: 'manual',
        status: 'running',
      }),
    );
    await closeStalePasses(deps([]), userId);
    const [row] = await withUser(handle.db, userId, (tx) =>
      tx.select().from(schema.collectionPasses).where(eq(schema.collectionPasses.id, stale!.id)),
    );
    expect(row).toMatchObject({ status: 'interrupted' });
    expect((await runsOf(userId, stale!.id))[0]).toMatchObject({
      status: 'failed',
      errorCode: 'interrupted',
    });
  });
});

/** A connector handing over the given offers, as written by its site. */
const giving = (
  name: string,
  offers: Array<{
    id: string;
    title: string;
    company?: string;
    description?: string;
    location?: string;
  }>,
) =>
  connector({
    name,
    run(context) {
      context.add(
        offers.map((offer) => ({
          externalId: offer.id,
          title: offer.title,
          company: offer.company ?? null,
          description: offer.description ?? null,
          location: offer.location ?? null,
          url: `https://jobs.example.org/${name}/${offer.id}`,
        })),
      );
      return Promise.resolve();
    },
  });

describe('announcements (ADR 0016)', () => {
  it('merge one offer carried by two sources, keep two employers apart, and count both', async () => {
    const userId = await account();
    const alpha = giving('alpha', [
      { id: 'a1', title: 'Comptable (m/f/x)', company: 'Exemple SA', description: 'Court.' },
      { id: 'a2', title: 'Business Analyst', company: 'Deloitte' },
    ]);
    const beta = giving('beta', [
      { id: 'b1', title: 'Comptable - Bruxelles', company: 'Exemple', description: 'Plus long.' },
      { id: 'b2', title: 'Business Analyst', company: 'BNP Paribas Fortis' },
    ]);
    const id = await pass(userId, ['alpha', 'beta']);
    await runPass(deps([alpha, beta]), { userId, passId: id });
    const [first, second] = await runsOf(userId, id);
    expect(first).toMatchObject({ source: 'alpha', newCount: 2, mergedCount: 0 });
    expect(second).toMatchObject({ source: 'beta', newCount: 1, mergedCount: 1 });

    const postings = await offersOf(userId);
    const byId = new Map(postings.map((posting) => [posting.externalId, posting]));
    expect(byId.get('b1')).toMatchObject({ offerId: byId.get('a1')!.offerId, mergeReason: 'key' });
    expect(byId.get('b1')!.contentKey).toBe(byId.get('a1')!.contentKey);
    expect(byId.get('b2')!.offerId).not.toBe(byId.get('a2')!.offerId);
    const announcements = await announcementsOf(userId);
    expect(announcements).toHaveLength(3);
    // The retained posting names the employer, then has the longest description.
    const comptable = announcements.find((offer) => offer.id === byId.get('a1')!.offerId)!;
    expect(comptable.retainedId).toBe(byId.get('b1')!.id);
    expect(comptable.firstSeenAt.getTime()).toBe(byId.get('a1')!.firstSeenAt.getTime());
    expect(comptable.lastSeenAt.getTime()).toBe(byId.get('b1')!.lastSeenAt.getTime());
  });

  it('never move a posting stored before, so an undone merge stays undone', async () => {
    const userId = await account();
    const alpha = giving('alpha', [{ id: 'a1', title: 'Comptable', company: 'Exemple' }]);
    const beta = giving('beta', [{ id: 'b1', title: 'Comptable', company: 'Exemple' }]);
    await runPass(deps([alpha, beta]), { userId, passId: await pass(userId, ['alpha', 'beta']) });
    // "Not the same offer", as the offer's page does it.
    await withUser(handle.db, userId, async (tx) => {
      const [own] = await tx.insert(schema.offers).values({ userId }).returning();
      await tx
        .update(schema.jobOffers)
        .set({ offerId: own!.id, mergeReason: null })
        .where(eq(schema.jobOffers.externalId, 'b1'));
    });
    const again = await pass(userId, ['alpha', 'beta']);
    await runPass(deps([alpha, beta]), { userId, passId: again });
    const postings = await offersOf(userId);
    expect(new Set(postings.map((posting) => posting.offerId)).size).toBe(2);
    expect((await runsOf(userId, again)).map((run) => run.mergedCount)).toEqual([0, 0]);
  });

  it('compare with the announcements of the last three weeks only', async () => {
    const userId = await account();
    const alpha = giving('alpha', [{ id: 'a1', title: 'Comptable', company: 'Exemple' }]);
    const beta = giving('beta', [{ id: 'b1', title: 'Comptable', company: 'Exemple' }]);
    const longAgo = new Date(Date.now() - 22 * 86_400_000);
    await runPass(deps([alpha], { now: () => longAgo }), {
      userId,
      passId: await pass(userId, ['alpha']),
    });
    const id = await pass(userId, ['beta']);
    await runPass(deps([beta]), { userId, passId: id });
    expect((await runsOf(userId, id))[0]).toMatchObject({ newCount: 1, mergedCount: 0 });
    expect(await announcementsOf(userId)).toHaveLength(2);
  });

  it('count new announcements and merges in test mode without writing anything', async () => {
    const userId = await account();
    const alpha = giving('alpha', [{ id: 'a1', title: 'Comptable', company: 'Exemple' }]);
    await runPass(deps([alpha]), { userId, passId: await pass(userId, ['alpha']) });
    const beta = giving('beta', [
      { id: 'b1', title: 'Comptable (H/F)', company: 'Exemple SA' },
      { id: 'b2', title: 'Juriste', company: 'Exemple' },
    ]);
    const id = await pass(userId, ['beta'], 'test');
    await runPass(deps([beta]), { userId, passId: id });
    expect((await runsOf(userId, id))[0]).toMatchObject({ newCount: 1, mergedCount: 1 });
    expect(await offersOf(userId)).toHaveLength(1);
  });

  it('identify the postings of phase 2 at start-up and regroup them once', async () => {
    const userId = await account();
    const days = (count: number) => new Date(Date.now() - count * 86_400_000);
    // As migration 0009 left them: one announcement each, under the posting's identifier.
    await withUser(handle.db, userId, async (tx) => {
      const legacy = [
        { id: 'l1', source: 'alpha', title: 'Comptable', company: 'Exemple', seen: days(3) },
        {
          id: 'l2',
          source: 'beta',
          title: 'Comptable (H/F)',
          company: 'Exemple SA',
          seen: days(2),
        },
        { id: 'l3', source: 'beta', title: 'Juriste', company: 'Exemple', seen: days(1) },
        // Two offers added by hand: the collected one joins the first, they stay apart.
        { id: 'm1', source: 'manual', title: 'Analyste', company: 'Autre', seen: days(5) },
        { id: 'm2', source: 'manual', title: 'Analyste', company: 'Autre', seen: days(4) },
        { id: 'l4', source: 'alpha', title: 'Analyste (m/f/x)', company: 'Autre', seen: days(3) },
      ];
      for (const item of legacy) {
        const [offer] = await tx
          .insert(schema.offers)
          .values({ userId, firstSeenAt: item.seen, lastSeenAt: item.seen })
          .returning();
        await tx.insert(schema.jobOffers).values({
          id: offer!.id,
          userId,
          offerId: offer!.id,
          source: item.source,
          externalId: item.id,
          title: item.title,
          company: item.company,
          firstSeenAt: item.seen,
          lastSeenAt: item.seen,
        });
        await tx
          .update(schema.offers)
          .set({ retainedId: offer!.id })
          .where(eq(schema.offers.id, offer!.id));
      }
    });
    const prepare = () =>
      prepareStoredPostings({ db: handle.db, logger, gazetteer, settings }, ['alpha', 'beta']);
    const result = await prepare();
    expect(result.identified).toBeGreaterThanOrEqual(3);
    expect(result.located).toBeGreaterThanOrEqual(6);
    const postings = await offersOf(userId);
    expect(postings.every((posting) => posting.contentKey !== null)).toBe(true);
    expect(postings.every((posting) => posting.dedupVersion === 1)).toBe(true);
    const byId = new Map(postings.map((posting) => [posting.externalId, posting]));
    expect(byId.get('l2')).toMatchObject({ offerId: byId.get('l1')!.offerId, mergeReason: 'key' });
    expect(byId.get('m2')!.offerId).not.toBe(byId.get('m1')!.offerId);
    expect(byId.get('l4')).toMatchObject({ offerId: byId.get('m1')!.offerId, mergeReason: 'key' });
    const announcements = await announcementsOf(userId);
    expect(announcements).toHaveLength(4);
    const comptable = announcements.find((offer) => offer.id === byId.get('l1')!.offerId)!;
    expect(comptable.lastSeenAt.getTime()).toBe(byId.get('l2')!.lastSeenAt.getTime());

    // Once only: the next start-up finds nothing to do.
    expect(await prepare()).toEqual({ identified: 0, regrouped: 0, located: 0, screened: 0 });
  });
});

describe('geography (ADR 0017)', () => {
  const based = async (city: string | null, postalCode: string | null = null) => {
    const userId = await account();
    await withUser(handle.db, userId, (tx) =>
      tx.insert(schema.profiles).values({ userId, baseCity: city, basePostalCode: postalCode }),
    );
    return userId;
  };

  it('locates each posting and measures its announcement from the base city', async () => {
    const userId = await based('Bruxelles', '1000');
    const alpha = giving('alpha', [
      { id: 'g1', title: 'Comptable', company: 'Exemple', location: 'Mechelen' },
      { id: 'g2', title: 'Juriste', company: 'Exemple', location: 'Gent, Flemish Region, Belgium' },
      { id: 'g3', title: 'Analyste', company: 'Exemple', location: 'Belgium' },
      { id: 'g4', title: 'Acheteur', company: 'Exemple', location: 'Montrouge, France' },
      {
        id: 'g5',
        title: 'Développeur (Remote)',
        company: 'Exemple',
        location: 'Bruxelles (hybride)',
      },
    ]);
    await runPass(deps([alpha]), { userId, passId: await pass(userId, ['alpha']) });
    const postings = await offersOf(userId);
    const byId = new Map(postings.map((posting) => [posting.externalId, posting]));
    expect(byId.get('g1')).toMatchObject({
      placeStatus: 'found',
      placeName: 'Mechelen',
      postalCode: '2800',
    });
    const announcements = new Map(
      (await announcementsOf(userId)).map((offer) => [offer.id, offer]),
    );
    const of = (id: string) => announcements.get(byId.get(id)!.offerId)!;
    expect(of('g1')).toMatchObject({ placeStatus: 'found', placeName: 'Mechelen', distanceKm: 27 });
    expect(of('g2')).toMatchObject({ placeStatus: 'found', placeName: 'Gent' });
    expect(of('g2').distanceKm).toBeGreaterThan(60);
    expect(of('g3')).toMatchObject({ placeStatus: 'unknown', distanceKm: null });
    expect(of('g4')).toMatchObject({ placeStatus: 'abroad', distanceKm: null });
    expect(of('g5')).toMatchObject({ placeName: 'Bruxelles', distanceKm: 0, remote: 'full' });
  });

  it('measures nothing without a base city found in the localities', async () => {
    const userId = await based('Nulle part');
    const alpha = giving('alpha', [{ id: 'n1', title: 'Comptable', location: 'Mechelen' }]);
    await runPass(deps([alpha]), { userId, passId: await pass(userId, ['alpha']) });
    const [offer] = await announcementsOf(userId);
    expect(offer).toMatchObject({ placeStatus: 'found', placeName: 'Mechelen', distanceKm: null });
  });

  it('centres the searches around a point on the base city, else on the configured area', async () => {
    const centres: Array<{ name: string; lat: number; lon: number }> = [];
    const spy = connector({
      name: 'alpha',
      run(context) {
        centres.push(context.center);
        return Promise.resolve();
      },
    });
    const malines = await based(null, '2800');
    await runPass(deps([spy]), { userId: malines, passId: await pass(malines, ['alpha']) });
    const nowhere = await based('Nulle part');
    await runPass(deps([spy]), { userId: nowhere, passId: await pass(nowhere, ['alpha']) });
    expect(centres[0]).toMatchObject({ name: 'Mechelen', lat: 51.0257 });
    expect(centres[1]).toEqual(settings.collect.area);
  });
});

describe('deterministic filter (phase 3 plan, section 6)', () => {
  it('sets aside what is certain after a pass, keeps the rest, and says why', async () => {
    const userId = await account();
    await withUser(handle.db, userId, async (tx) => {
      await tx.insert(schema.profiles).values({
        userId,
        baseCity: 'Bruxelles',
        radiusKm: 30,
        contractTypes: ['permanent'],
      });
      await tx.insert(schema.excludedCompanies).values({ userId, name: 'Deloitte' });
      await tx
        .insert(schema.eliminationRules)
        .values({ userId, kind: 'language', value: 'Allemand' });
    });
    const day = (offset: number) =>
      new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const alpha = connector({
      name: 'alpha',
      run(context) {
        context.add([
          {
            externalId: 'f1',
            title: 'Comptable',
            company: 'Exemple',
            location: 'Mechelen',
            url: 'https://jobs.example.org/f1',
          },
          {
            externalId: 'f2',
            title: 'Juriste',
            company: 'Deloitte Legal',
            location: 'Bruxelles',
            url: 'https://jobs.example.org/f2',
          },
          {
            externalId: 'f3',
            title: 'Analyste',
            company: 'Exemple',
            location: 'Bruxelles',
            postedAt: day(70),
            url: 'https://jobs.example.org/f3',
          },
          {
            externalId: 'f4',
            title: 'Acheteur',
            company: 'Exemple',
            location: 'Gent',
            url: 'https://jobs.example.org/f4',
          },
          {
            externalId: 'f5',
            title: 'Développeur (Remote)',
            company: 'Exemple',
            location: 'Gent',
            url: 'https://jobs.example.org/f5',
          },
          {
            externalId: 'f6',
            title: 'Assistant',
            company: 'Exemple',
            location: 'Bruxelles',
            languages: ['Allemand'],
            url: 'https://jobs.example.org/f6',
          },
          {
            externalId: 'f7',
            title: 'Magasinier',
            company: 'Exemple',
            location: 'Bruxelles',
            contract: 'Intérimaire',
            url: 'https://jobs.example.org/f7',
          },
          {
            externalId: 'f8',
            title: 'Gestionnaire',
            company: 'Exemple',
            location: 'Belgium',
            url: 'https://jobs.example.org/f8',
          },
        ]);
        return Promise.resolve();
      },
    });
    await runPass(deps([alpha]), { userId, passId: await pass(userId, ['alpha']) });
    const postings = await offersOf(userId);
    const announcements = new Map(
      (await announcementsOf(userId)).map((offer) => [offer.id, offer]),
    );
    const reason = (id: string) =>
      announcements.get(postings.find((posting) => posting.externalId === id)!.offerId)!
        .excludedReason;
    expect(reason('f1')).toBeNull();
    expect(reason('f2')).toBe('excluded_company');
    expect(reason('f3')).toBe('too_old');
    expect(reason('f4')).toBe('too_far');
    expect(reason('f5')).toBeNull();
    expect(reason('f6')).toBe('language');
    expect(reason('f7')).toBe('contract');
    expect(reason('f8')).toBeNull();
    expect([...announcements.values()].every((offer) => offer.screenedAt !== null)).toBe(true);

    // The criteria change (the API then asks the worker): every offer is read again.
    await withUser(handle.db, userId, async (tx) => {
      await tx
        .update(schema.profiles)
        .set({ radiusKm: 80, contractTypes: [] })
        .where(eq(schema.profiles.userId, userId));
      const result = await screenOffers(
        tx,
        userId,
        null,
        await screenProfileOf(tx, userId, settings, new Date()),
        new Date(),
      );
      expect(result).toEqual({ screened: 8, excluded: 3 });
    });
    const after = new Map((await announcementsOf(userId)).map((offer) => [offer.id, offer]));
    const now = (id: string) =>
      after.get(postings.find((posting) => posting.externalId === id)!.offerId)!.excludedReason;
    expect(now('f4')).toBeNull();
    expect(now('f7')).toBeNull();
    expect(now('f2')).toBe('excluded_company');
  });

  it('screens at start-up the announcements never screened', async () => {
    const userId = await account();
    await withUser(handle.db, userId, async (tx) => {
      const [offer] = await tx.insert(schema.offers).values({ userId }).returning();
      await tx.insert(schema.jobOffers).values({
        userId,
        offerId: offer!.id,
        source: 'alpha',
        externalId: 'old',
        title: 'Comptable',
        company: 'Exemple',
        postedOn: '2020-01-01',
        dedupVersion: 1,
        contentKey: 'k',
        bareTitle: 'comptable',
        placeStatus: 'unknown',
      });
    });
    await prepareStoredPostings({ db: handle.db, logger, gazetteer, settings }, ['alpha']);
    const [offer] = await announcementsOf(userId);
    expect(offer).toMatchObject({ excludedReason: 'too_old' });
    expect(offer!.screenedAt).not.toBeNull();
  });
});

describe('silent sources (decision D4)', () => {
  /** A source reading as many ads as the test asks, all of them kept. */
  function counted(name: string) {
    const state = { read: 0 };
    const source = connector({
      name,
      run(context) {
        const offers = Array.from({ length: state.read }, (_, index) => ({
          externalId: `${name}-${index}`,
          title: 'Comptable',
          url: `https://jobs.example.org/${name}/${index}`,
        }));
        context.add(offers, state.read);
        return Promise.resolve();
      },
    });
    return { source, state };
  }

  async function settingOf(userId: string, source: string) {
    const [row] = await withUser(handle.db, userId, (tx) =>
      tx.select().from(schema.sourceSettings).where(eq(schema.sourceSettings.source, source)),
    );
    return row;
  }

  it('raise an alert on nothing read without an error, tell the phone once, then clear it', async () => {
    const userId = await account();
    const { source, state } = counted('alpha');
    const sent: Array<{ userId: string; title: string; body: string; url: string }> = [];
    const notify = (to: string, message: { title: string; body: string; url: string }) => {
      sent.push({ userId: to, ...message });
      return Promise.resolve();
    };
    state.read = 0;
    await runPass(deps([source], { notify }), { userId, passId: await pass(userId, ['alpha']) });
    expect(await settingOf(userId, 'alpha')).toMatchObject({ alert: 'zero_read', alertRead: 0 });
    expect(sent).toEqual([
      expect.objectContaining({ userId, title: 'Source muette', url: '/sources' }),
    ]);
    expect(sent[0]!.body).toContain('alpha');

    // Still silent: the same incident, no second notice.
    const since = (await settingOf(userId, 'alpha'))!.alertSince;
    await runPass(deps([source], { notify }), { userId, passId: await pass(userId, ['alpha']) });
    expect(sent).toHaveLength(1);
    expect((await settingOf(userId, 'alpha'))!.alertSince).toEqual(since);

    // It reads again: the alert goes.
    state.read = 12;
    await runPass(deps([source], { notify }), { userId, passId: await pass(userId, ['alpha']) });
    expect(await settingOf(userId, 'alpha')).toMatchObject({ alert: null, alertSince: null });
  });

  it('raise an alert when the volume collapses against the previous runs', async () => {
    const userId = await account();
    const { source, state } = counted('beta');
    state.read = 40;
    for (let index = 0; index < 4; index += 1) {
      await runPass(deps([source]), { userId, passId: await pass(userId, ['beta']) });
    }
    expect((await settingOf(userId, 'beta'))?.alert ?? null).toBeNull();
    state.read = 3;
    await runPass(deps([source]), { userId, passId: await pass(userId, ['beta']) });
    expect(await settingOf(userId, 'beta')).toMatchObject({
      alert: 'collapse',
      alertRead: 3,
      alertUsual: 40,
    });
    // Without push keys, the banner alone tells: the incident counts as told.
    expect((await settingOf(userId, 'beta'))!.alertNotifiedAt).not.toBeNull();
  });

  it('never judge a test pass, a skipped source or a failed one', async () => {
    const userId = await account();
    const { source, state } = counted('gamma');
    state.read = 0;
    await runPass(deps([source]), { userId, passId: await pass(userId, ['gamma'], 'test') });
    expect((await settingOf(userId, 'gamma'))?.alert ?? null).toBeNull();
    const failing = connector({
      name: 'pages',
      run: () => Promise.reject(new Error('the page changed')),
    });
    await runPass(deps([failing]), { userId, passId: await pass(userId, ['pages']) });
    expect((await settingOf(userId, 'pages'))?.alert ?? null).toBeNull();
  });

  it('judge a run against the median of the previous ones, from three of them', () => {
    const mute = { history: 6, minUsual: 10, collapseRatio: 0.25 };
    expect(judgeRun({ status: 'succeeded', readCount: 0 }, [], mute).kind).toBe('zero_read');
    // A partial run that read nothing failed somewhere: it is in error, not silent.
    expect(judgeRun({ status: 'partial', readCount: 0 }, [], mute).kind).toBeNull();
    expect(judgeRun({ status: 'succeeded', readCount: 2 }, [40, 38], mute).kind).toBeNull();
    expect(judgeRun({ status: 'succeeded', readCount: 9 }, [40, 38, 41], mute)).toEqual({
      kind: 'collapse',
      usual: 40,
    });
    expect(judgeRun({ status: 'succeeded', readCount: 11 }, [40, 38, 41], mute).kind).toBeNull();
    // A small source that reads little is not judged on a drop.
    expect(judgeRun({ status: 'succeeded', readCount: 1 }, [6, 8, 7], mute).kind).toBeNull();
  });
});

describe('keywords of a source', () => {
  const keywords = [
    { keyword: 'comptable', priority: true },
    { keyword: 'Comptable', priority: false },
    { keyword: 'fiscaliste', priority: false },
  ];
  it('takes the whole list or the priority ones, once each, and one in test mode', () => {
    const full = connector({ name: 'alpha', run: () => Promise.resolve() });
    const rationed = { ...full, keywordLevel: 'priority' as const };
    expect(keywordsFor(full, keywords, 'manual', 10)).toEqual(['comptable', 'fiscaliste']);
    expect(keywordsFor(rationed, keywords, 'manual', 10)).toEqual(['comptable']);
    expect(keywordsFor(full, keywords, 'test', 10)).toEqual(['comptable']);
    // Without any priority keyword, the first ones stand in.
    const plain = keywords.map((keyword) => ({ ...keyword, priority: false }));
    expect(keywordsFor(rationed, plain, 'manual', 1)).toEqual(['comptable']);
    expect(keywordsFor({ ...full, family: 'fixed_list' }, keywords, 'manual', 10)).toEqual([]);
  });
});

describe('schedule and purge', () => {
  it('plans the sources due on the Brussels weekday', () => {
    const tuesday = new Date('2026-11-24T06:10:00Z');
    expect(isoWeekday(tuesday, 'Europe/Brussels')).toBe(2);
    // Sunday 23:30 UTC is already Monday in Brussels.
    expect(isoWeekday(new Date('2026-11-22T23:30:00Z'), 'Europe/Brussels')).toBe(1);
    const list = [reader('alpha'), reader('linked')];
    expect(dueSources(list, settings, tuesday)).toEqual(['alpha', 'linked']);
    expect(dueSources(list, settings, new Date('2026-11-23T06:10:00Z'))).toEqual(['alpha']);
  });

  it('creates one scheduled pass per active account and queues it', async () => {
    const userId = await account();
    const sent: Array<{ userId: string; passId: string }> = [];
    const result = await schedulePasses(
      {
        db: handle.db,
        settings,
        logger,
        connectors: [reader('alpha')],
        queue: {
          send: (_name, data) => {
            sent.push(data);
            return Promise.resolve('job');
          },
        },
      },
      new Date('2026-11-24T06:10:00Z'),
    );
    expect(result.passes).toBeGreaterThanOrEqual(1);
    const mine = sent.find((job) => job.userId === userId)!;
    const [row] = await withUser(handle.db, userId, (tx) =>
      tx.select().from(schema.collectionPasses).where(eq(schema.collectionPasses.id, mine.passId)),
    );
    expect(row).toMatchObject({ trigger: 'scheduled', status: 'queued', sources: ['alpha'] });
  });

  it('deletes offers not seen for 90 days and pass logs older than a year', async () => {
    const userId = await account();
    const now = new Date();
    const days = (count: number) => new Date(now.getTime() - count * 86_400_000);
    const [oldPass] = await withUser(handle.db, userId, async (tx) => {
      const [fresh, stale] = await tx
        .insert(schema.offers)
        .values([
          { userId, lastSeenAt: days(10) },
          { userId, lastSeenAt: days(91) },
        ])
        .returning();
      // The announcement's last sighting counts: its stale posting stays with it.
      await tx.insert(schema.jobOffers).values([
        { userId, offerId: fresh!.id, source: 'alpha', externalId: 'fresh', title: 'Fresh' },
        {
          userId,
          offerId: fresh!.id,
          source: 'beta',
          externalId: 'old',
          title: 'Fresh',
          lastSeenAt: days(95),
        },
        { userId, offerId: stale!.id, source: 'alpha', externalId: 'stale', title: 'Stale' },
      ]);
      return tx
        .insert(schema.collectionPasses)
        .values({ userId, trigger: 'scheduled', status: 'done', createdAt: days(400) })
        .returning();
    });
    await withUser(handle.db, userId, (tx) =>
      tx.insert(schema.sourceRuns).values({
        userId,
        passId: oldPass!.id,
        source: 'alpha',
        trigger: 'scheduled',
        status: 'succeeded',
      }),
    );
    const result = await purgeCollection(handle.db, settings, now);
    expect(result.offers).toBeGreaterThanOrEqual(1);
    expect((await offersOf(userId)).map((offer) => offer.externalId).sort()).toEqual([
      'fresh',
      'old',
    ]);
    expect(await announcementsOf(userId)).toHaveLength(1);
    expect(await runsOf(userId, oldPass!.id)).toHaveLength(0);
  });
});
