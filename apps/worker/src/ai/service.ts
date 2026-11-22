import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Settings } from '@job4me/config';
import type { AiCallStatus, AiErrorCode, AiUsage } from '@job4me/contracts';
import { and, type Database, eq, gte, schema, sql, withUser } from '@job4me/db';
import type { Logger } from '@job4me/logger';
import type { z } from 'zod';
import { costOf, type ModelUsage, sumTokens, worstCase } from './costs';

// The only Claude client (ADR 0009), in the worker. Before each call: the caps of the
// configuration against the ai_call log; after it: one ai_call row with tokens and cost, never
// the prompt or the answer. No tool is given to the model: it can only answer in the schema.

type Effort = Settings['ai']['cvStructuring']['effort'];

export interface AiTask<T> {
  usage: AiUsage;
  userId: string;
  model: string;
  maxTokens: number;
  effort: Effort;
  /** Server-side fallback when the model declines (Claude Sonnet 5.5 only). */
  fallbacks: boolean;
  /** Stable instructions: cached between calls. */
  system: string;
  /** The data, already wrapped in its tags. */
  user: string;
  schema: z.ZodType<T>;
}

export type AiResult<T> = { ok: true; value: T } | { ok: false; error: AiErrorCode };

export interface AiService {
  readonly enabled: boolean;
  run<T>(task: AiTask<T>): Promise<AiResult<T>>;
}

export interface AiDeps {
  db: Database;
  settings: Settings;
  logger: Logger;
  /** Absent or empty: the AI is off (development, CI, a machine without a key). */
  apiKey: string | undefined;
  /** Tests replace the transport; nothing else may (no other base URL, no proxy). */
  fetch?: typeof fetch;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const DAY_MS = 86_400_000;

/** Token counts per model: the iterations when a fallback ran, else the whole response. */
function usagesOf(message: Anthropic.Beta.BetaMessage, requested: string): ModelUsage[] {
  const usage = message.usage;
  const iterations = (usage.iterations ?? []).filter(
    (
      entry,
    ): entry is
      Anthropic.Beta.BetaMessageIterationUsage | Anthropic.Beta.BetaFallbackMessageIterationUsage =>
      entry.type === 'message' || entry.type === 'fallback_message',
  );
  if (iterations.length > 0) {
    return iterations.map((entry) => ({
      model: entry.model ?? requested,
      input: entry.input_tokens,
      output: entry.output_tokens,
      cacheRead: entry.cache_read_input_tokens,
      cacheWrite: entry.cache_creation_input_tokens,
    }));
  }
  return [
    {
      model: message.model,
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
    },
  ];
}

/** The JSON answer: the last text block, after any switch to a fallback model. */
function answerOf(message: Anthropic.Beta.BetaMessage): string | null {
  const texts = message.content.filter(
    (block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text',
  );
  return texts.at(-1)?.text ?? null;
}

export function createAiService(deps: AiDeps): AiService {
  const settings = deps.settings.ai;
  const client = deps.apiKey
    ? new Anthropic({
        apiKey: deps.apiKey,
        timeout: settings.timeoutMs,
        maxRetries: settings.maxRetries,
        // The SDK's own logs could carry request details: ours say what is needed.
        logLevel: 'off',
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      })
    : null;

  async function spent(userId: string): Promise<{ week: number; total: number }> {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [row] = await withUser(deps.db, userId, (tx) =>
      tx
        .select({
          week: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}) filter (where ${schema.aiCalls.createdAt} >= ${since}), 0)::float8`,
          total: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}), 0)::float8`,
        })
        .from(schema.aiCalls)
        .where(eq(schema.aiCalls.userId, userId)),
    );
    return { week: row?.week ?? 0, total: row?.total ?? 0 };
  }

  async function record(
    task: AiTask<unknown>,
    status: AiCallStatus,
    details: { usages?: ModelUsage[]; requestId?: string | null; durationMs?: number } = {},
  ) {
    const usages = details.usages ?? [];
    const tokens = sumTokens(usages);
    const costUsd = costOf(settings, usages);
    await withUser(deps.db, task.userId, (tx) =>
      tx.insert(schema.aiCalls).values({
        userId: task.userId,
        usage: task.usage,
        model: usages.at(-1)?.model ?? task.model,
        status,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cacheReadTokens: tokens.cacheRead,
        cacheWriteTokens: tokens.cacheWrite,
        costUsd,
        requestId: details.requestId ?? null,
        durationMs: details.durationMs ?? null,
      }),
    );
    deps.logger.info(
      { usage: task.usage, status, costUsd, ...tokens, durationMs: details.durationMs },
      'ai call',
    );
  }

  /** Refuses the call when even its worst case would cross a cap. */
  async function withinCaps(task: AiTask<unknown>): Promise<boolean> {
    const { week, total } = await spent(task.userId);
    const estimate = worstCase(settings, {
      model: task.model,
      inputChars: task.system.length + task.user.length,
      maxTokens: task.maxTokens,
      fallback: task.fallbacks,
    });
    return week + estimate <= settings.caps.weeklyUsd && total + estimate <= settings.caps.totalUsd;
  }

  async function run<T>(task: AiTask<T>): Promise<AiResult<T>> {
    if (!client) {
      await record(task, 'disabled');
      return { ok: false, error: 'ai_disabled' };
    }
    const format = zodOutputFormat(task.schema as z.ZodType);
    // An invalid answer gets a second try, then the step fails with a clear message.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (!(await withinCaps(task))) {
        await record(task, 'blocked');
        return { ok: false, error: 'ai_cap_reached' };
      }
      const started = Date.now();
      let message: Anthropic.Beta.BetaMessage;
      let requestId: string | null;
      try {
        const response = await client.beta.messages
          .create({
            model: task.model,
            max_tokens: task.maxTokens,
            system: [{ type: 'text', text: task.system, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: task.user }],
            output_config: {
              effort: task.effort,
              format: { type: 'json_schema', schema: format.schema },
            },
            ...(task.fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
          })
          .withResponse();
        message = response.data;
        requestId = response.request_id ?? null;
      } catch (error) {
        const failedId = error instanceof Anthropic.APIError ? (error.requestID ?? null) : null;
        const status: unknown = error instanceof Anthropic.APIError ? error.status : undefined;
        const httpStatus = typeof status === 'number' ? status : undefined;
        deps.logger.warn({ usage: task.usage, httpStatus, requestId: failedId }, 'ai call failed');
        await record(task, 'failed', { requestId: failedId, durationMs: Date.now() - started });
        return { ok: false, error: 'ai_failed' };
      }
      const details = {
        usages: usagesOf(message, task.model),
        requestId,
        durationMs: Date.now() - started,
      };
      if (message.stop_reason === 'refusal') {
        await record(task, 'refused', details);
        return { ok: false, error: 'ai_refused' };
      }
      const parsed = (() => {
        const answer = answerOf(message);
        if (message.stop_reason === 'max_tokens' || answer === null) return null;
        try {
          const result = task.schema.safeParse(JSON.parse(answer));
          return result.success ? result : null;
        } catch {
          return null;
        }
      })();
      if (parsed) {
        await record(task, 'succeeded', details);
        return { ok: true, value: parsed.data };
      }
      await record(task, 'invalid_output', details);
    }
    return { ok: false, error: 'ai_invalid_output' };
  }

  return { enabled: client !== null, run };
}

/** What has been spent, for the Settings > AI screen and the tests. */
export async function spentSince(db: Database, userId: string, since: Date): Promise<number> {
  const [row] = await withUser(db, userId, (tx) =>
    tx
      .select({ total: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}), 0)::float8` })
      .from(schema.aiCalls)
      .where(and(eq(schema.aiCalls.userId, userId), gte(schema.aiCalls.createdAt, since))),
  );
  return row?.total ?? 0;
}
