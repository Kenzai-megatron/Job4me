import { type Benchmark, benchmarkSchema } from '@job4me/contracts';
import type { ScoringBenchmarkRow } from '@job4me/db';

// A measure of the reference set (phase 3 plan, section 9) as the API and the command show it.

export function toBenchmark(row: ScoringBenchmarkRow): Benchmark {
  const claude =
    row.claudeRated !== null &&
    row.claudeMeanGap !== null &&
    row.quickModel &&
    row.detailedModel &&
    row.promptVersion
      ? {
          rated: row.claudeRated,
          meanGap: row.claudeMeanGap,
          worst: row.claudeWorst ?? [],
          quickModel: row.quickModel,
          detailedModel: row.detailedModel,
          promptVersion: row.promptVersion,
          costUsd: row.costUsd,
          costPerOfferUsd: row.claudeRated > 0 ? row.costUsd / row.claudeRated : 0,
        }
      : null;
  return benchmarkSchema.parse({
    id: row.id,
    status: row.status,
    errorCode: row.errorCode,
    withClaude: row.withClaude,
    rated: row.rated,
    rules:
      row.rulesVersion && row.rulesMeanGap !== null
        ? { version: row.rulesVersion, meanGap: row.rulesMeanGap, worst: row.rulesWorst ?? [] }
        : null,
    claude,
    titleFilter:
      row.filterRated !== null && row.filterRejected !== null
        ? { rated: row.filterRated, rejected: row.filterRejected }
        : null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  });
}
