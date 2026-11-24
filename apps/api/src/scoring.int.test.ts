import type { Benchmark, BenchmarksResponse, Offer } from '@job4me/contracts';
import { eq, schema, withUser } from '@job4me/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliError } from './cli/commands';
import { formatBenchmark, scoringBenchmark, scoringRun } from './cli/scoring';
import { createTestApp } from './testing/app';
import { signedInBrowser } from './testing/session';

// The reference set from the API side (phase 3 plan, sections 9 and 10): « Ma note » on an offer,
// the measures, and the command that asks the worker for one. Fictitious offers only.

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
  });
});

afterAll(async () => {
  await ctx?.close();
});

/** Plays the worker: one announcement with its retained posting. */
async function offerOf(userId: string, title: string): Promise<string> {
  return withUser(ctx.deps.db, userId, async (tx) => {
    const [offer] = await tx.insert(schema.offers).values({ userId }).returning();
    const [posting] = await tx
      .insert(schema.jobOffers)
      .values({
        userId,
        offerId: offer!.id,
        source: 'alpha',
        externalId: title,
        title,
        company: 'Exemple SA',
      })
      .returning();
    await tx
      .update(schema.offers)
      .set({ retainedId: posting!.id })
      .where(eq(schema.offers.id, offer!.id));
    return offer!.id;
  });
}

describe('« Ma note » (the reference set)', () => {
  it('rates an offer of the account, changes and removes the rating', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'rating');
    const offerId = await offerOf(userId, 'Comptable');
    const rated = await browser.send('PUT', `/api/offers/${offerId}/rating`, {
      value: 85,
      note: '  Idéal, près de chez moi.  ',
    });
    expect(rated.statusCode).toBe(200);
    expect(rated.json<Offer>().rating).toMatchObject({
      value: 85,
      note: 'Idéal, près de chez moi.',
    });
    const changed = await browser.send('PUT', `/api/offers/${offerId}/rating`, { value: 70 });
    expect(changed.json<Offer>().rating).toMatchObject({ value: 70, note: null });
    expect((await browser.get(`/api/offers/${offerId}`)).json<Offer>().rating?.value).toBe(70);
    const summary = (await browser.get('/api/scoring/benchmarks')).json<BenchmarksResponse>();
    expect(summary).toMatchObject({
      rated: 1,
      goal: 30,
      maxMeanGap: 10,
      filterRating: 60,
      benchmarks: [],
    });

    const removed = await browser.send('DELETE', `/api/offers/${offerId}/rating`);
    expect(removed.json<Offer>().rating).toBeNull();
    expect((await browser.get('/api/scoring/benchmarks')).json<BenchmarksResponse>().rated).toBe(0);
  });

  it('refuses a rating out of bounds or a note too long', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'rating-bounds');
    const offerId = await offerOf(userId, 'Comptable');
    for (const body of [
      { value: 101 },
      { value: -1 },
      { value: 7.5 },
      { value: 50, note: 'x'.repeat(201) },
    ]) {
      expect((await browser.send('PUT', `/api/offers/${offerId}/rating`, body)).statusCode).toBe(
        400,
      );
    }
  });

  it('never rates, shows nor counts the offer of another account', async () => {
    const alice = await signedInBrowser(ctx, 'rating-alice');
    const bob = await signedInBrowser(ctx, 'rating-bob');
    const offerId = await offerOf(alice.userId, 'Comptable');
    await alice.browser.send('PUT', `/api/offers/${offerId}/rating`, { value: 90 });
    expect(
      (await bob.browser.send('PUT', `/api/offers/${offerId}/rating`, { value: 10 })).statusCode,
    ).toBe(404);
    expect((await bob.browser.send('DELETE', `/api/offers/${offerId}/rating`)).statusCode).toBe(
      404,
    );
    expect(
      (await bob.browser.get('/api/scoring/benchmarks')).json<BenchmarksResponse>().rated,
    ).toBe(0);
    expect((await alice.browser.get(`/api/offers/${offerId}`)).json<Offer>().rating?.value).toBe(
      90,
    );
  });

  it('needs a session', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/scoring/benchmarks' });
    expect(response.statusCode).toBe(401);
  });
});

describe('measure of the reference set, from the command line', () => {
  it('queues the measure for the worker, follows it and prints the gaps', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'benchmark-cli');
    const [user] = await ctx.deps.db.select().from(schema.users).where(eq(schema.users.id, userId));
    const offerId = await offerOf(userId, 'Comptable');
    await browser.send('PUT', `/api/offers/${offerId}/rating`, { value: 80 });
    const printed: string[] = [];
    const benchmark = await scoringBenchmark(ctx.deps.db, ctx.deps.config, {
      email: user!.email,
      claude: false,
      queue: {
        send: (name, data) => {
          queued.push({ name, data });
          // Plays the worker, a little later.
          setTimeout(() => {
            void withUser(ctx.deps.db, userId, (tx) =>
              tx
                .update(schema.scoringBenchmarks)
                .set({
                  status: 'done',
                  rated: 1,
                  rulesVersion: 'rules-1',
                  rulesMeanGap: 12.5,
                  rulesWorst: [{ offerId, title: 'Comptable', rating: 80, score: 55 }],
                  filterRated: 1,
                  filterRejected: 0,
                  finishedAt: new Date(),
                })
                .where(eq(schema.scoringBenchmarks.id, String(data.benchmarkId))),
            );
          }, 30);
          return Promise.resolve('job');
        },
      },
      pollMs: 10,
      print: (line) => printed.push(line),
    });
    expect(queued.at(-1)).toMatchObject({ name: 'scoring_benchmark', data: { userId } });
    expect(benchmark).toMatchObject({
      status: 'done',
      withClaude: false,
      rules: { meanGap: 12.5 },
    });
    expect(printed[0]).toBe('Mesure lancée sur 1 offre(s) notée(s). En attente du worker…');
    expect(printed[1]).toContain(
      'Notation sans IA (rules-1) : écart moyen 12,5 points, au-dessus du seuil de 10',
    );
    expect(printed[1]).toContain('Comptable : ta note 80, score 55 (écart 25)');
    expect(printed[1]).toContain('Pré-filtre de titre : 0 sur 1 offres notées 60 ou plus');
    // The measure is listed for the account.
    const listed = (await browser.get('/api/scoring/benchmarks')).json<BenchmarksResponse>();
    expect(listed.benchmarks[0]).toMatchObject({ id: benchmark.id, status: 'done' });
  });

  it('measures nothing without a rating', async () => {
    const { userId } = await signedInBrowser(ctx, 'benchmark-empty');
    const [user] = await ctx.deps.db.select().from(schema.users).where(eq(schema.users.id, userId));
    await expect(
      scoringBenchmark(ctx.deps.db, ctx.deps.config, {
        email: user!.email,
        claude: true,
        queue: { send: () => Promise.resolve('job') },
        print: () => undefined,
      }),
    ).rejects.toThrow(CliError);
  });

  it('formats Claude’s measure, its cost and a failure', () => {
    const benchmark: Benchmark = {
      id: '01a20db9-0000-7000-8000-000000000001',
      status: 'failed',
      errorCode: 'ai_cap_reached',
      withClaude: true,
      rated: 30,
      rules: { version: 'rules-1', meanGap: 8.2, worst: [] },
      claude: {
        rated: 25,
        meanGap: 6.4,
        worst: [],
        quickModel: 'claude-haiku-5-5',
        detailedModel: 'claude-sonnet-5-5',
        promptVersion: 'quick-1+detailed-1',
        costUsd: 0.25,
        costPerOfferUsd: 0.01,
      },
      titleFilter: { rated: 20, rejected: 2 },
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    const text = formatBenchmark(benchmark, ctx.deps.config);
    expect(text).toContain('écart moyen 8,2 points, sous le seuil de 10');
    expect(text).toContain('sur 25 offres hors étalon : écart moyen 6,4 points');
    expect(text).toContain('Coût : 0,25 $, soit 0,01 $ par offre');
    expect(text).toContain(
      '2 sur 20 offres notées 60 ou plus auraient été écartées (10 %, au plus 5 %) : à revoir',
    );
    expect(text).toContain('Mesure en échec : plafond de dépense atteint');
  });

  it('asks for the scoring by Claude only when it is switched on', async () => {
    const { userId } = await signedInBrowser(ctx, 'scoring-run');
    const [user] = await ctx.deps.db.select().from(schema.users).where(eq(schema.users.id, userId));
    const sent: string[] = [];
    const queue = {
      send: (name: string) => {
        sent.push(name);
        return Promise.resolve('job');
      },
    };
    await expect(
      scoringRun(ctx.deps.db, ctx.deps.config, {
        email: user!.email,
        queue,
        print: () => undefined,
      }),
    ).rejects.toThrow(/JOB4ME_AI_SCORING=true/);
    expect(sent).toEqual([]);
    const settings = ctx.deps.config.settings.ai.scoring;
    settings.enabled = true;
    try {
      await scoringRun(ctx.deps.db, ctx.deps.config, {
        email: user!.email,
        queue,
        print: () => undefined,
      });
    } finally {
      settings.enabled = false;
    }
    expect(sent).toEqual(['offers_ai_score']);
  });
});
