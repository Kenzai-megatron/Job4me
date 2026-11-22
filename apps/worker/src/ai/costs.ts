import type { Settings } from '@job4me/config';

// Cost of a call from its token counts and the prices of the configuration (never in the code).

export type Prices = Settings['ai']['prices'][string];

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** One model's share of a response: the main model, then any server-side fallback. */
export interface ModelUsage extends TokenCounts {
  model: string;
}

export function priceOf(settings: Settings['ai'], model: string): Prices {
  return settings.prices[model] ?? settings.unknownModelPrice;
}

/** USD, rounded to the micro-dollar like the cost_usd column. */
export function costOf(settings: Settings['ai'], usages: ModelUsage[]): number {
  let total = 0;
  for (const usage of usages) {
    const price = priceOf(settings, usage.model);
    total +=
      (usage.input * price.input +
        usage.output * price.output +
        usage.cacheRead * price.cacheRead +
        usage.cacheWrite * price.cacheWrite) /
      1_000_000;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

export function sumTokens(usages: ModelUsage[]): TokenCounts {
  return usages.reduce(
    (sum, usage) => ({
      input: sum.input + usage.input,
      output: sum.output + usage.output,
      cacheRead: sum.cacheRead + usage.cacheRead,
      cacheWrite: sum.cacheWrite + usage.cacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
}

/**
 * The most a request may cost before it is sent: every input token written to the cache, every
 * output token, and with a fallback the dearer of the two price lists.
 */
export function worstCase(
  settings: Settings['ai'],
  request: { model: string; inputChars: number; maxTokens: number; fallback: boolean },
): number {
  const main = priceOf(settings, request.model);
  const other = request.fallback ? settings.unknownModelPrice : main;
  const input = Math.max(main.input, main.cacheWrite, other.input, other.cacheWrite);
  const output = Math.max(main.output, other.output);
  const inputTokens = Math.ceil(request.inputChars / settings.charsPerToken);
  return (inputTokens * input + request.maxTokens * output) / 1_000_000;
}
