import { compileTitleFilter, RULES_VERSION, type TitleFilterRule } from '@job4me/collect';
import type { BenchmarkErrorCode, BenchmarkGap, ScoringBenchmarkJob } from '@job4me/contracts';
import { and, eq, gte, schema, sql, withUser } from '@job4me/db';
import { DETAILED_PROMPT_VERSION, QUICK_PROMPT_VERSION } from '../ai/scoring';
import { analyse, type ClaudeScoringDeps, openSession, scoreQuickly } from './claude';
import { type OfferFacts, offerFactsOf, rulesScoreOf, scoringContextOf } from './scoring';

// The measure of the reference set (phase 3 plan, section 9; decision D1), asked for from the
// home machine (`pnpm stack:cli scoring:benchmark`): the scoring without AI against Mehdi's
// ratings, always (free); Claude too when asked, through the very steps of the scoring after a
// pass, on the rated offers that are not its calibration; and the share of the offers rated 60
// or more that the title filter would have set aside. Only figures are kept, never a text.

const WORST = 5;

interface Measured {
  facts: OfferFacts;
  rating: number;
  score: number;
}

/** The mean gap, and the widest ones first. */
function gaps(items: readonly Measured[]): { meanGap: number; worst: BenchmarkGap[] } {
  const gap = (item: Measured) => Math.abs(item.rating - item.score);
  const meanGap =
    items.length === 0 ? 0 : items.reduce((sum, item) => sum + gap(item), 0) / items.length;
  const worst = [...items]
    .sort((a, b) => gap(b) - gap(a) || a.facts.id.localeCompare(b.facts.id))
    .slice(0, WORST)
    .map((item) => ({
      offerId: item.facts.id,
      title: item.facts.rules.title,
      rating: item.rating,
      score: item.score,
    }));
  return { meanGap: Math.round(meanGap * 10) / 10, worst };
}

export async function runBenchmark(
  deps: ClaudeScoringDeps,
  job: ScoringBenchmarkJob,
): Promise<void> {
  const { userId, benchmarkId } = job;
  const table = schema.scoringBenchmarks;
  const [benchmark] = await withUser(deps.db, userId, (tx) =>
    tx
      .update(table)
      .set({ status: 'running', updatedAt: new Date() })
      .where(and(eq(table.id, benchmarkId), eq(table.userId, userId), eq(table.status, 'queued')))
      .returning(),
  );
  if (!benchmark) return;
  const finish = (values: Partial<typeof table.$inferInsert>) =>
    withUser(deps.db, userId, (tx) =>
      tx
        .update(table)
        .set({ ...values, finishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(table.id, benchmarkId), eq(table.userId, userId))),
    );
  try {
    const now = deps.now?.() ?? new Date();
    const { context, ratings, offers, titleRules } = await withUser(deps.db, userId, async (tx) => {
      const ratingRows = await tx
        .select({ offerId: schema.offerRatings.offerId, rating: schema.offerRatings.rating })
        .from(schema.offerRatings)
        .where(eq(schema.offerRatings.userId, userId));
      return {
        context: await scoringContextOf(tx, userId, deps.settings, now),
        ratings: new Map(ratingRows.map((row) => [row.offerId, row.rating])),
        offers: await offerFactsOf(
          tx,
          userId,
          ratingRows.map((row) => row.offerId),
          { kept: false },
        ),
        titleRules: await tx
          .select({
            list: schema.titleFilterRules.list,
            expression: schema.titleFilterRules.expression,
          })
          .from(schema.titleFilterRules)
          .where(eq(schema.titleFilterRules.userId, userId)),
      };
    });
    if (offers.length === 0) {
      await finish({ status: 'failed', errorCode: 'no_rating' });
      return;
    }
    const ratingOf = (facts: OfferFacts) => ratings.get(facts.id) ?? 0;
    const { reference } = deps.settings.scoring;

    // The scoring without AI, on every rated offer.
    const rules = gaps(
      offers.map((facts) => ({
        facts,
        rating: ratingOf(facts),
        score: rulesScoreOf(facts, context).score,
      })),
    );
    // The title filter of the profile, replayed on the offers rated 60 or more.
    const passes = compileTitleFilter(
      titleRules.map((rule) => ({
        list: rule.list as TitleFilterRule['list'],
        expression: rule.expression,
      })),
    );
    const high = offers.filter((facts) => ratingOf(facts) >= reference.filterRating);
    const rejected = high.filter((facts) => !passes(facts.rules.title)).length;
    const measured = {
      rated: offers.length,
      rulesVersion: RULES_VERSION,
      rulesMeanGap: rules.meanGap,
      rulesWorst: rules.worst,
      filterRated: high.length,
      filterRejected: rejected,
    };

    if (!benchmark.withClaude) {
      await finish({ status: 'done', ...measured });
      return;
    }
    if (!deps.ai.enabled) {
      await finish({ status: 'failed', errorCode: 'ai_disabled', ...measured });
      return;
    }
    // Claude, through the steps of the scoring after a pass; its calibration is left aside.
    const started = new Date();
    const settings = deps.settings.ai.scoring;
    const session = openSession(deps, userId, context.claude, {
      quick: 'scoring_benchmark',
      detailed: 'scoring_benchmark',
    });
    const calibration = new Set(context.claude.calibrationIds);
    const pool = offers.filter((facts) => !calibration.has(facts.id));
    const baseline = new Map(pool.map((facts) => [facts.id, rulesScoreOf(facts, context).score]));
    const final = new Map<string, number>();
    await scoreQuickly(session, pool, baseline, (scored) => {
      for (const item of scored) final.set(item.facts.id, item.score);
      return Promise.resolve();
    });
    for (const facts of pool) {
      const quick = final.get(facts.id);
      if (session.outcome.status === 'stopped') break;
      if (quick === undefined || quick < settings.detailed.threshold) continue;
      if (facts.claude.description === '') continue;
      const answer = await analyse(session, facts);
      if (answer.ok) final.set(facts.id, answer.value.score);
    }
    const [spent] = await withUser(deps.db, userId, (tx) =>
      tx
        .select({
          total: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}), 0)::float8`,
        })
        .from(schema.aiCalls)
        .where(
          and(
            eq(schema.aiCalls.userId, userId),
            eq(schema.aiCalls.usage, 'scoring_benchmark'),
            gte(schema.aiCalls.createdAt, started),
          ),
        ),
    );
    const claude = gaps(
      pool.flatMap((facts) => {
        const score = final.get(facts.id);
        return score === undefined ? [] : [{ facts, rating: ratingOf(facts), score }];
      }),
    );
    const stopped = session.outcome.stopReason;
    const errorCode: BenchmarkErrorCode | null =
      stopped ?? (pool.length > 0 && final.size === 0 ? 'ai_invalid_output' : null);
    await finish({
      status: errorCode ? 'failed' : 'done',
      errorCode,
      ...measured,
      claudeRated: final.size,
      claudeMeanGap: claude.meanGap,
      claudeWorst: claude.worst,
      quickModel: settings.quick.model,
      detailedModel: settings.detailed.model,
      promptVersion: `${QUICK_PROMPT_VERSION}+${DETAILED_PROMPT_VERSION}`,
      costUsd: spent?.total ?? 0,
    });
    deps.logger.info(
      { rated: offers.length, claudeRated: final.size, errorCode, ...session.outcome },
      'reference set measured',
    );
  } catch (error) {
    deps.logger.error(
      { err: error instanceof Error ? error.message : 'unknown' },
      'reference set not measured',
    );
    await finish({ status: 'failed' }).catch(() => undefined);
  }
}
