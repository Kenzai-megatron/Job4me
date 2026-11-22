import { loadConfig } from '@job4me/config';
import { describe, expect, it } from 'vitest';
import { costOf, worstCase } from './costs';

const settings = (() => {
  process.env.JOB4ME_ENV ??= 'test';
  return loadConfig().settings.ai;
})();

describe('AI costs from the configuration', () => {
  it('prices every kind of token, by model', () => {
    const cost = costOf(settings, [
      {
        model: 'claude-sonnet-5-5',
        input: 1_000_000,
        output: 100_000,
        cacheRead: 1_000_000,
        cacheWrite: 0,
      },
    ]);
    // 2 $ input + 1 $ output + 0.10 $ cache reads.
    expect(cost).toBeCloseTo(3.1, 6);
  });

  it('prices a model it does not know (a fallback) at the cautious price', () => {
    const cost = costOf(settings, [
      { model: 'claude-sonnet-5-5', input: 0, output: 1000, cacheRead: 0, cacheWrite: 0 },
      { model: 'claude-opus-4-8', input: 0, output: 1000, cacheRead: 0, cacheWrite: 0 },
    ]);
    expect(cost).toBeCloseTo((1000 * 10 + 1000 * settings.unknownModelPrice.output) / 1e6, 6);
  });

  it('estimates the worst case before sending, the fallback included', () => {
    const plain = worstCase(settings, {
      model: 'claude-sonnet-5-5',
      inputChars: 3000,
      maxTokens: 8000,
      fallback: false,
    });
    const withFallback = worstCase(settings, {
      model: 'claude-sonnet-5-5',
      inputChars: 3000,
      maxTokens: 8000,
      fallback: true,
    });
    expect(plain).toBeCloseTo((1000 * 2.5 + 8000 * 10) / 1e6, 6);
    expect(withFallback).toBeGreaterThan(plain);
  });
});
