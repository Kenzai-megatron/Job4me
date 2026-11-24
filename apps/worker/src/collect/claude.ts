import type { Settings } from '@job4me/config';
import { type AiErrorCode, type AiUsage, detailedScoringSchema } from '@job4me/contracts';
import { type Database, type schema, withUser } from '@job4me/db';
import type { Logger } from '@job4me/logger';
import {
  DETAILED_PROMPT_VERSION,
  detailedResult,
  detailedSystemPrompt,
  detailedUserMessage,
  inTurns,
  isSuspect,
  QUICK_PROMPT_VERSION,
  quickAnswerSchema,
  quickResults,
  quickSystemPrompt,
  quickUserMessage,
} from '../ai/scoring';
import type { AiService } from '../ai/service';
import { type ClaudeContext, isCurrentClaudeScore } from './claude-context';
import {
  type OfferFacts,
  offerFactsOf,
  rulesRow,
  rulesScoreOf,
  scoringContextOf,
  writeScores,
} from './scoring';

// The scoring by Claude (phase 3 plan, sections 7 bis, 8 and 11; ADR 0018), off by default
// (decision D5). After a pass: the kept offers without a current Claude score, in turn from each
// source up to the per-pass cap, by batches to Claude Haiku 5.5; then the offers of 70 or more,
// one at a time, to Claude Sonnet 5.5. Whatever fails keeps its score without AI, marked as such;
// a cap reached or the API out of reach stops the run, the rest waits for the next pass. The
// measure of the reference set goes through the very same steps (benchmark.ts).

export interface ClaudeScoringDeps {
  db: Database;
  ai: AiService;
  settings: Settings;
  logger: Logger;
  now?: () => Date;
}

export interface ClaudeScoringOutcome {
  /** off: the setting; no_key: no API key on this machine; stopped: a cap or the API. */
  status: 'off' | 'no_key' | 'done' | 'stopped';
  stopReason: AiErrorCode | null;
  /** Offers scored by Claude Haiku, then analysed by Claude Sonnet. */
  quick: number;
  detailed: number;
  batches: number;
  /** Batches scored again offer by offer (threat 1). */
  suspect: number;
  /** Offers left with their score without AI after a failed answer. */
  failed: number;
  /** Offers beyond the per-pass cap: the next pass takes them. */
  waiting: number;
  /** Scores by Claude no longer current, back to the score without AI. */
  replaced: number;
}

type Row = typeof schema.offerScores.$inferInsert;
type Quick =
  | { ok: true; results: Array<{ score: number; reason: string }> }
  | { ok: false; error: AiErrorCode };
export type Analysis =
  { ok: true; value: ReturnType<typeof detailedResult> } | { ok: false; error: AiErrorCode };

/** Errors after which no other request of this run is sent. */
const STOPPING: ReadonlySet<AiErrorCode> = new Set(['ai_cap_reached', 'ai_failed', 'ai_disabled']);

export function emptyOutcome(status: ClaudeScoringOutcome['status']): ClaudeScoringOutcome {
  return {
    status,
    stopReason: null,
    quick: 0,
    detailed: 0,
    batches: 0,
    suspect: 0,
    failed: 0,
    waiting: 0,
    replaced: 0,
  };
}

/** One run of requests to Claude: its prompts, its usages in the log, its counts. */
export interface Session {
  deps: ClaudeScoringDeps;
  userId: string;
  claude: ClaudeContext;
  usages: { quick: AiUsage; detailed: AiUsage };
  outcome: ClaudeScoringOutcome;
  quickSystem: string;
  detailedSystem: string;
}

export function openSession(
  deps: ClaudeScoringDeps,
  userId: string,
  claude: ClaudeContext,
  usages: Session['usages'] = { quick: 'scoring_quick', detailed: 'scoring_detailed' },
): Session {
  const settings = deps.settings.ai.scoring;
  return {
    deps,
    userId,
    claude,
    usages,
    outcome: emptyOutcome('done'),
    quickSystem: quickSystemPrompt({
      profile: claude.profile,
      instructions: claude.instructions,
      examples: claude.examples,
      settings,
    }),
    detailedSystem: detailedSystemPrompt({
      profile: claude.profile,
      instructions: claude.instructions,
      weights: claude.weights,
      settings,
    }),
  };
}

function stop(session: Session, error: AiErrorCode) {
  session.outcome.status = 'stopped';
  session.outcome.stopReason = error;
}

async function ask(session: Session, batch: readonly OfferFacts[]): Promise<Quick> {
  const settings = session.deps.settings.ai.scoring;
  session.outcome.batches += 1;
  const result = await session.deps.ai.run({
    usage: session.usages.quick,
    userId: session.userId,
    model: settings.quick.model,
    maxTokens: settings.quick.maxTokens,
    effort: settings.quick.effort,
    fallbacks: false,
    system: session.quickSystem,
    user: quickUserMessage(
      batch.map((facts) => facts.claude),
      settings,
    ),
    schema: quickAnswerSchema(batch.length, settings),
  });
  if (!result.ok) return result;
  return { ok: true, results: quickResults(result.value, batch.length, settings) };
}

/**
 * Quick scores for these offers, by batches: a batch that fails for a reason of its own (a
 * refusal, an unusable answer) or whose every score jumps (threat 1) is scored again offer by
 * offer. `keep` receives each score; the offers left unscored are counted as failed or waiting.
 */
export async function scoreQuickly(
  session: Session,
  offers: readonly OfferFacts[],
  baseline: ReadonlyMap<string, number>,
  keep: (scored: Array<{ facts: OfferFacts; score: number; reason: string }>) => Promise<void>,
): Promise<void> {
  const settings = session.deps.settings.ai.scoring;
  const outcome = session.outcome;
  const oneByOne = async (batch: readonly OfferFacts[]) => {
    for (const facts of batch) {
      if (outcome.status === 'stopped') {
        outcome.waiting += 1;
        continue;
      }
      const answer = await ask(session, [facts]);
      if (!answer.ok) {
        outcome.failed += 1;
        if (STOPPING.has(answer.error)) stop(session, answer.error);
        continue;
      }
      const [result] = answer.results;
      if (!result) continue;
      await keep([{ facts, ...result }]);
      outcome.quick += 1;
    }
  };
  for (let index = 0; index < offers.length; index += settings.quick.batchSize) {
    const batch = offers.slice(index, index + settings.quick.batchSize);
    if (outcome.status === 'stopped') {
      outcome.waiting += batch.length;
      continue;
    }
    const answer = await ask(session, batch);
    if (!answer.ok) {
      if (STOPPING.has(answer.error)) {
        stop(session, answer.error);
        outcome.failed += batch.length;
      } else if (batch.length > 1) {
        // A refusal or an unusable answer: one offer may be the cause, the others still count.
        await oneByOne(batch);
      } else {
        outcome.failed += 1;
      }
      continue;
    }
    const scores = answer.results.map((result) => result.score);
    const before = batch.map((facts) => baseline.get(facts.id) ?? null);
    if (isSuspect(scores, before, settings)) {
      outcome.suspect += 1;
      session.deps.logger.warn(
        { offers: batch.length },
        'suspect scoring batch: scored again one by one',
      );
      await oneByOne(batch);
      continue;
    }
    const scored = batch.flatMap((facts, at) => {
      const result = answer.results[at];
      return result ? [{ facts, ...result }] : [];
    });
    await keep(scored);
    outcome.quick += scored.length;
  }
}

/** The detailed analysis of one offer by Claude Sonnet, its score from the profile's grid. */
export async function analyse(session: Session, facts: OfferFacts): Promise<Analysis> {
  const settings = session.deps.settings.ai.scoring;
  const answer = await session.deps.ai.run({
    usage: session.usages.detailed,
    userId: session.userId,
    model: settings.detailed.model,
    maxTokens: settings.detailed.maxTokens,
    effort: settings.detailed.effort,
    fallbacks: settings.detailed.fallbacks,
    system: session.detailedSystem,
    user: detailedUserMessage(facts.claude, settings),
    schema: detailedScoringSchema,
  });
  if (!answer.ok) {
    session.outcome.failed += 1;
    if (STOPPING.has(answer.error)) stop(session, answer.error);
    return answer;
  }
  session.outcome.detailed += 1;
  return { ok: true, value: detailedResult(answer.value, session.claude.weights, settings) };
}

export async function scoreWithClaude(
  deps: ClaudeScoringDeps,
  userId: string,
): Promise<ClaudeScoringOutcome> {
  const settings = deps.settings.ai.scoring;
  if (!settings.enabled) return emptyOutcome('off');
  if (!deps.ai.enabled) {
    deps.logger.warn('claude scoring on, but no API key: scores without AI kept');
    return emptyOutcome('no_key');
  }
  const now = deps.now?.() ?? new Date();
  const { context, offers } = await withUser(deps.db, userId, async (tx) => {
    const scoring = await scoringContextOf(tx, userId, deps.settings, now);
    return { context: scoring, offers: await offerFactsOf(tx, userId, null) };
  });
  const claude = context.claude;
  const session = openSession(deps, userId, claude);
  const outcome = session.outcome;
  const isCurrent = (facts: OfferFacts) =>
    facts.current !== null && isCurrentClaudeScore(facts.current, claude, facts.claudeVersion);
  const baseline = new Map(offers.map((facts) => [facts.id, rulesScoreOf(facts, context).score]));
  const written = new Set<string>();
  const write = async (rows: Row[]) => {
    if (rows.length === 0) return;
    await withUser(deps.db, userId, (tx) => writeScores(tx, rows));
    for (const row of rows) written.add(row.offerId);
  };
  const quickRow = (facts: OfferFacts, score: number, reason: string): Row => ({
    userId,
    offerId: facts.id,
    method: 'claude_quick',
    score,
    // Scored on its title alone: never an automatic sending (phase 5).
    confidence: facts.claude.description === '' ? 'low' : 'normal',
    factors: [],
    reason,
    analysis: null,
    model: settings.quick.model,
    promptVersion: QUICK_PROMPT_VERSION,
    profileVersion: claude.version,
    offerVersion: facts.claudeVersion,
    scoredAt: now,
    updatedAt: now,
  });

  // 1. Quick scoring: the most promising first within each source, sources in turn.
  const todo = inTurns(
    offers
      .filter((facts) => !isCurrent(facts))
      .sort(
        (a, b) =>
          (baseline.get(b.id) ?? 0) - (baseline.get(a.id) ?? 0) ||
          b.firstSeenAt.getTime() - a.firstSeenAt.getTime(),
      ),
    (facts) => facts.sources[0] ?? '?',
  );
  const selected = todo.slice(0, settings.quick.perPass);
  outcome.waiting = todo.length - selected.length;
  const quickScores = new Map<string, number>();
  await scoreQuickly(session, selected, baseline, async (scored) => {
    await write(scored.map((item) => quickRow(item.facts, item.score, item.reason)));
    for (const item of scored) quickScores.set(item.facts.id, item.score);
  });

  // 2. Detailed analysis of the offers of 70 or more with a text, one at a time.
  const candidates = offers
    .flatMap((facts) => {
      if (facts.claude.description === '') return [];
      const fresh = quickScores.get(facts.id);
      if (fresh !== undefined) return [{ facts, score: fresh }];
      const current = facts.current;
      return current?.method === 'claude_quick' && isCurrent(facts)
        ? [{ facts, score: current.score }]
        : [];
    })
    .filter((item) => item.score >= settings.detailed.threshold)
    .sort(
      (a, b) => b.score - a.score || b.facts.firstSeenAt.getTime() - a.facts.firstSeenAt.getTime(),
    );
  const analysed = candidates.slice(0, settings.detailed.perPass);
  outcome.waiting += candidates.length - analysed.length;
  for (const { facts } of analysed) {
    if (outcome.status === 'stopped') {
      outcome.waiting += 1;
      continue;
    }
    // On a failure the quick score stays; the next pass tries again.
    const answer = await analyse(session, facts);
    if (!answer.ok) continue;
    const result = answer.value;
    await write([
      {
        ...quickRow(facts, result.score, result.reason),
        method: 'claude_detailed',
        confidence: 'normal',
        analysis: result.analysis,
        model: settings.detailed.model,
        promptVersion: DETAILED_PROMPT_VERSION,
      },
    ]);
  }

  // 3. A score by Claude no longer current and not made again gives way to the score without AI.
  const stale = offers.filter(
    (facts) =>
      !written.has(facts.id) &&
      facts.current !== null &&
      facts.current.method !== 'rules' &&
      !isCurrent(facts),
  );
  if (stale.length > 0) {
    await write(stale.map((facts) => rulesRow(userId, facts, context, now)));
    outcome.replaced = stale.length;
  }
  deps.logger.info({ ...outcome }, 'offers scored by claude');
  return outcome;
}
