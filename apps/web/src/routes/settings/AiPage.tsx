import { formatDateTime, formatNumber } from '@job4me/i18n';
import { Alert, Card } from '@job4me/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { aiUsageQuery } from '../../api/ai';
import { errorMessage } from '../../components/errors';
import { SettingsTabs } from './SettingsTabs';

/** Dollars as the Anthropic invoice shows them: two decimals, or four below one cent. */
function dollars(value: number): string {
  return `${formatNumber(Number(value.toFixed(value > 0 && value < 0.01 ? 4 : 2)))} $`;
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
