import type { Settings } from '@job4me/config';
import { type AiErrorCode, detailedScoringSchema } from '@job4me/contracts';
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
import { isCurrentClaudeScore } from './claude-context';
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
// a cap reached or the API out of reach stops the run, the rest waits for the next pass.

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

/** Errors after which no other request of this run is sent. */
const STOPPING: ReadonlySet<AiErrorCode> = new Set(['ai_cap_reached', 'ai_failed', 'ai_disabled']);

function empty(status: ClaudeScoringOutcome['status']): ClaudeScoringOutcome {
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

export async function scoreWithClaude(
  deps: ClaudeScoringDeps,
  userId: string,
): Promise<ClaudeScoringOutcome> {
  const settings = deps.settings.ai.scoring;
  if (!settings.enabled) return empty('off');
  if (!deps.ai.enabled) {
    deps.logger.warn('claude scoring on, but no API key: scores without AI kept');
    return empty('no_key');
  }
  const now = deps.now?.() ?? new Date();
  const { context, offers } = await withUser(deps.db, userId, async (tx) => {
    const scoring = await scoringContextOf(tx, userId, deps.settings, now);
    return { context: scoring, offers: await offerFactsOf(tx, userId, null) };
  });
  const outcome = empty('done');
  const claude = context.claude;
  const isCurrent = (facts: OfferFacts) =>
    facts.current !== null && isCurrentClaudeScore(facts.current, claude, facts.claudeVersion);
  const baseline = new Map(offers.map((facts) => [facts.id, rulesScoreOf(facts, context).score]));
  const written = new Set<string>();
  const write = async (rows: Row[]) => {
    if (rows.length === 0) return;
    await withUser(deps.db, userId, (tx) => writeScores(tx, rows));
    for (const row of rows) written.add(row.offerId);
  };
  const stop = (error: AiErrorCode) => {
    outcome.status = 'stopped';
    outcome.stopReason = error;
  };

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
  const system = quickSystemPrompt({
    profile: claude.profile,
    instructions: claude.instructions,
    examples: claude.examples,
    settings,
  });
  const ask = async (batch: readonly OfferFacts[]): Promise<Quick> => {
    outcome.batches += 1;
    const result = await deps.ai.run({
      usage: 'scoring_quick',
      userId,
      model: settings.quick.model,
      maxTokens: settings.quick.maxTokens,
      effort: settings.quick.effort,
      fallbacks: false,
      system,
      user: quickUserMessage(
        batch.map((facts) => facts.claude),
        settings,
      ),
      schema: quickAnswerSchema(batch.length, settings),
    });
    if (!result.ok) return result;
    return { ok: true, results: quickResults(result.value, batch.length, settings) };
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
  const quickScores = new Map<string, number>();
  /** Each offer on its own: after a suspect batch, or to isolate the offer a batch failed on. */
  const oneByOne = async (batch: readonly OfferFacts[]) => {
    for (const facts of batch) {
      if (outcome.status === 'stopped') {
        outcome.waiting += 1;
        continue;
      }
      const answer = await ask([facts]);
      if (!answer.ok) {
        outcome.failed += 1;
        if (STOPPING.has(answer.error)) stop(answer.error);
        continue;
      }
      const [result] = answer.results;
      if (!result) continue;
      await write([quickRow(facts, result.score, result.reason)]);
      quickScores.set(facts.id, result.score);
      outcome.quick += 1;
    }
  };
  for (let index = 0; index < selected.length; index += settings.quick.batchSize) {
    const batch = selected.slice(index, index + settings.quick.batchSize);
    if (outcome.status === 'stopped') {
      outcome.waiting += batch.length;
      continue;
    }
    const answer = await ask(batch);
    if (!answer.ok) {
      if (STOPPING.has(answer.error)) {
        stop(answer.error);
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
    if (
      isSuspect(
        scores,
        batch.map((facts) => baseline.get(facts.id) ?? null),
        settings,
      )
    ) {
      outcome.suspect += 1;
      deps.logger.warn({ offers: batch.length }, 'suspect scoring batch: scored again one by one');
      await oneByOne(batch);
      continue;
    }
    const rows: Row[] = [];
    batch.forEach((facts, at) => {
      const result = answer.results[at];
      if (!result) return;
      rows.push(quickRow(facts, result.score, result.reason));
      quickScores.set(facts.id, result.score);
    });
    await write(rows);
    outcome.quick += rows.length;
  }

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
  const detailedSystem = detailedSystemPrompt({
    profile: claude.profile,
    instructions: claude.instructions,
    weights: claude.weights,
    settings,
  });
  for (const { facts } of analysed) {
    if (outcome.status === 'stopped') {
      outcome.waiting += 1;
      continue;
    }
    const answer = await deps.ai.run({
      usage: 'scoring_detailed',
      userId,
      model: settings.detailed.model,
      maxTokens: settings.detailed.maxTokens,
      effort: settings.detailed.effort,
      fallbacks: settings.detailed.fallbacks,
      system: detailedSystem,
      user: detailedUserMessage(facts.claude, settings),
      schema: detailedScoringSchema,
    });
    if (!answer.ok) {
      // The quick score stays; the next pass tries again.
      outcome.failed += 1;
      if (STOPPING.has(answer.error)) stop(answer.error);
      continue;
    }
    const result = detailedResult(answer.value, claude.weights, settings);
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
    outcome.detailed += 1;
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
