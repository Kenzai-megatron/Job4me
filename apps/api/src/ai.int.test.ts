import type { AiUsageResponse, KeywordRun } from '@job4me/contracts';
import { schema, withUser } from '@job4me/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './testing/app';
import { signedInBrowser } from './testing/session';

// The API side of the AI (plan, section 8): it queues, it shows the costs, it never calls Claude.

const queued: { name: string; data: Record<string, unknown> }[] = [];
let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp({
    queue: {
      send: async (name, data) => {
        queued.push({ name, data });
        return 'job';
      },
    },
  });
});

afterAll(async () => {
  await ctx?.close();
});

describe('keyword proposal', () => {
  it('needs a target job first', async () => {
    const { browser } = await signedInBrowser(ctx, 'no-target');
    const response = await browser.post('/api/profile/keywords/propose');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'keywords_need_target_job' });
  });

  it('queues one request for the worker, and only one at a time', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'propose');
    await browser.post('/api/profile/target-jobs', { title: 'Analyste de données' });
    const before = queued.length;
    const first = await browser.post('/api/profile/keywords/propose');
    expect(first.statusCode).toBe(200);
    const run = first.json<KeywordRun>();
    expect(run).toMatchObject({ status: 'queued', proposed: 0, errorCode: null });
    expect(queued.slice(before)).toEqual([
      { name: 'keywords_propose', data: { userId, runId: run.id } },
    ]);

    const again = (await browser.post('/api/profile/keywords/propose')).json<KeywordRun>();
    expect(again.id).toBe(run.id);
    expect(queued.length).toBe(before + 1);
    const latest = (await browser.get('/api/profile/keywords/propose')).json<{ run: KeywordRun }>();
    expect(latest.run.id).toBe(run.id);
  });
});

describe('AI usage', () => {
  it('sums the costs of the signed-in user, without any content', async () => {
    const alice = await signedInBrowser(ctx, 'usage-alice');
    const bob = await signedInBrowser(ctx, 'usage-bob');
    const old = new Date(Date.now() - 10 * 86_400_000);
    await withUser(ctx.deps.db, alice.userId, (tx) =>
      tx.insert(schema.aiCalls).values([
        {
          userId: alice.userId,
          usage: 'cv_structuring',
          model: 'claude-haiku-5-5',
          status: 'succeeded',
          inputTokens: 900,
          outputTokens: 300,
          cacheReadTokens: 100,
          costUsd: 0.25,
        },
        {
          userId: alice.userId,
          usage: 'keywords',
          model: 'claude-sonnet-5-5',
          status: 'succeeded',
          costUsd: 1.5,
          createdAt: old,
        },
      ]),
    );
    const usage = (await alice.browser.get('/api/ai/usage')).json<AiUsageResponse>();
    expect(usage.weekUsd).toBeCloseTo(0.25, 6);
    expect(usage.totalUsd).toBeCloseTo(1.75, 6);
    expect(usage.caps).toEqual(ctx.deps.config.settings.ai.caps);
    expect(usage.calls[0]).toMatchObject({
      usage: 'cv_structuring',
      inputTokens: 1000,
      cacheReadTokens: 100,
    });
    expect(Object.keys(usage.calls[0]!).sort()).toEqual([
      'cacheReadTokens',
      'costUsd',
      'createdAt',
      'id',
      'inputTokens',
      'model',
      'outputTokens',
      'status',
      'usage',
    ]);

    const theirs = (await bob.browser.get('/api/ai/usage')).json<AiUsageResponse>();
    expect(theirs).toMatchObject({ weekUsd: 0, totalUsd: 0, calls: [] });
  });
});
