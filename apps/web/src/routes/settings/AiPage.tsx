import type { Benchmark } from '@job4me/contracts';
import { formatDateTime, formatNumber } from '@job4me/i18n';
import { Alert, Card } from '@job4me/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { aiUsageQuery, benchmarksQuery } from '../../api/ai';
import { errorMessage } from '../../components/errors';
import { SettingsTabs } from './SettingsTabs';

/** Dollars as the Anthropic invoice shows them: two decimals, or four below one cent. */
function dollars(value: number): string {
  return `${formatNumber(Number(value.toFixed(value > 0 && value < 0.01 ? 4 : 2)))} $`;
}

/** The command of the home machine that measures the reference set (not a text to translate). */
const BENCHMARK_COMMAND = 'pnpm stack:cli scoring:benchmark';

function BenchmarkLines({
  benchmark,
  filterRating,
}: {
  benchmark: Benchmark;
  filterRating: number;
}) {
  const { t } = useTranslation();
  const date = formatDateTime(benchmark.createdAt);
  const gap = (value: number) => formatNumber(value);
  if (benchmark.status === 'queued' || benchmark.status === 'running') {
    return <li className="py-3 text-sm">{t('ai.reference.running', { date })}</li>;
  }
  return (
    <li className="flex flex-col gap-1 py-3 text-sm">
      {benchmark.rules ? (
        <span className="font-medium">
          {t('ai.reference.rules', { date, gap: gap(benchmark.rules.meanGap) })}
        </span>
      ) : null}
      {benchmark.claude ? (
        <span>
          {t('ai.reference.claude', {
            gap: gap(benchmark.claude.meanGap),
            rated: benchmark.claude.rated,
            cost: dollars(benchmark.claude.costPerOfferUsd),
          })}
        </span>
      ) : null}
      {benchmark.titleFilter ? (
        <span className="text-muted">
          {t('ai.reference.filter', {
            rejected: benchmark.titleFilter.rejected,
            count: benchmark.titleFilter.rated,
            rating: filterRating,
          })}
        </span>
      ) : null}
      {benchmark.status === 'failed' ? (
        <span>
          {t('ai.reference.failed', {
            reason: benchmark.errorCode ? t(`ai.reference.errors.${benchmark.errorCode}`) : '',
          })}
        </span>
      ) : null}
    </li>
  );
}

/** The reference set (phase 3 plan, section 9): ratings given, last measures, how to measure. */
function ReferenceSet() {
  const { t } = useTranslation();
  const reference = useQuery(benchmarksQuery);
  const data = reference.data;
  if (!data) return null;
  return (
    <Card aria-labelledby="ai-reference-title">
      <div className="flex flex-col gap-3">
        <h2 id="ai-reference-title" className="text-lg font-semibold">
          {t('ai.reference.title')}
        </h2>
        <p>{t('ai.reference.progress', { count: data.rated, goal: data.goal })}</p>
        <p className="text-sm text-muted">{t('ai.reference.howTo')}</p>
        <code className="self-start rounded-md bg-surface-muted px-2 py-1 font-mono text-sm">
          {BENCHMARK_COMMAND}
        </code>
        <p className="text-sm text-muted">
          {t('ai.reference.withClaude')} {t('ai.reference.threshold', { max: data.maxMeanGap })}
        </p>
        {data.benchmarks.length === 0 ? (
          <p className="text-sm">{t('ai.reference.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {data.benchmarks.map((benchmark) => (
              <BenchmarkLines
                key={benchmark.id}
                benchmark={benchmark}
                filterRating={data.filterRating}
              />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** Settings > AI (plan, section 7): what the calls cost against the caps, never what they said. */
export function AiPage() {
  const { t } = useTranslation();
  const usage = useQuery(aiUsageQuery);
  const data = usage.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('ai.title')}</h1>
        <p className="text-muted">{t('ai.intro')}</p>
      </div>
      <SettingsTabs />
      {usage.isError ? <Alert tone="error">{errorMessage(t, usage.error)}</Alert> : null}
      {data ? (
        <>
          <Card aria-labelledby="ai-spend-title">
            <div className="flex flex-col gap-3">
              <h2 id="ai-spend-title" className="text-lg font-semibold">
                {t('ai.spend')}
              </h2>
              <p>
                {t('ai.week', { amount: dollars(data.weekUsd), cap: dollars(data.caps.weeklyUsd) })}
              </p>
              <p>
                {t('ai.total', {
                  amount: dollars(data.totalUsd),
                  cap: dollars(data.caps.totalUsd),
                })}
              </p>
              <p className="text-sm text-muted">{t('ai.capsHint')}</p>
            </div>
          </Card>
          <ReferenceSet />
          {data.byUsage.length > 0 ? (
            <Card aria-labelledby="ai-usages-title">
              <div className="flex flex-col gap-3">
                <h2 id="ai-usages-title" className="text-lg font-semibold">
                  {t('ai.byUsage')}
                </h2>
                <ul className="flex flex-col divide-y divide-line">
                  {data.byUsage.map((item) => (
                    <li key={item.usage} className="flex flex-col gap-1 py-3">
                      <span className="font-medium">{t(`ai.usages.${item.usage}`)}</span>
                      <span className="text-sm text-muted">
                        {t('ai.usageSpend', {
                          week: dollars(item.weekUsd),
                          total: dollars(item.totalUsd),
                          count: item.calls,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          ) : null}
          <Card aria-labelledby="ai-calls-title">
            <div className="flex flex-col gap-3">
              <h2 id="ai-calls-title" className="text-lg font-semibold">
                {t('ai.calls')}
              </h2>
              {data.calls.length === 0 ? (
                <p className="text-sm text-muted">{t('ai.empty')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {data.calls.map((call) => (
                    <li key={call.id} className="flex flex-col gap-1 py-3">
                      <span className="font-medium">
                        {t(`ai.usages.${call.usage}`)} · {t(`ai.statuses.${call.status}`)}
                      </span>
                      <span className="text-sm text-muted">
                        {[
                          formatDateTime(call.createdAt),
                          call.model,
                          t('ai.tokens', {
                            input: formatNumber(call.inputTokens),
                            output: formatNumber(call.outputTokens),
                          }),
                          dollars(call.costUsd),
                        ].join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
