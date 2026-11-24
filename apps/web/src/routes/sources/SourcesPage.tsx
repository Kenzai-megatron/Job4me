import type { CollectionPass, SourceSummary } from '@job4me/contracts';
import { formatDate, formatDateTime, formatNumber, localeFor } from '@job4me/i18n';
import { Alert, Button, Card, CheckboxField } from '@job4me/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { latestTestQuery, sourcesQuery } from '../../api/collect';
import { errorMessage } from '../../components/errors';
import { RunSummary } from './RunSummary';

/** The days of the scheduled passes ("mardi et vendredi"), "every day" when there are seven. */
function useDays() {
  const { t, i18n } = useTranslation();
  const list = new Intl.ListFormat(localeFor(i18n.language), { type: 'conjunction' });
  return (weekdays: number[]) =>
    weekdays.length === 7
      ? t('sources.everyDay')
      : t('sources.days', {
          days: list.format(weekdays.map((day) => t(`sources.weekdays.${day}`))),
        });
}

function SourceCard({ source }: { source: SourceSummary }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const days = useDays();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The switch moves at once; it moves back if the server refuses.
  const [enabled, setEnabled] = useState(source.enabled);
  useEffect(() => setEnabled(source.enabled), [source.enabled]);
  const titleId = `source-${source.name}`;
  const latest = source.runs[0];

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    setEnabled(next);
    try {
      const updated = await api.patch<SourceSummary>(`/api/sources/${source.name}`, {
        enabled: next,
      });
      queryClient.setQueryData(sourcesQuery.queryKey, (data) =>
        data
          ? {
              ...data,
              sources: data.sources.map((item) => (item.name === updated.name ? updated : item)),
            }
          : data,
      );
    } catch (caught) {
      setEnabled(!next);
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="article" aria-labelledby={titleId}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {t(`sources.names.${source.name}`, { defaultValue: source.name })}
            </h2>
            <p className="text-sm text-muted">
              {[
                t(`sources.accesses.${source.access}`),
                source.personalUseOnly ? t('sources.personalUse') : null,
                days(source.weekdays),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <CheckboxField
            label={source.locked ? t('sources.locked') : t('sources.enabled')}
            checked={enabled}
            disabled={source.locked || busy}
            onChange={(event) => void toggle(event.target.checked)}
          />
        </div>
        {source.cooldownUntil ? (
          <p className="text-sm">
            {t('sources.cooldown', { date: formatDateTime(source.cooldownUntil) })}
          </p>
        ) : null}
        {source.alert ? (
          <p className="text-sm font-semibold text-danger">
            {t(`sources.alerts.${source.alert.kind}`, {
              date: formatDate(source.alert.since),
              read: formatNumber(source.alert.read ?? 0),
              usual: formatNumber(source.alert.usual ?? 0),
            })}
          </p>
        ) : null}
        {latest ? (
          <RunSummary run={latest} />
        ) : (
          <p className="text-sm text-muted">{t('sources.never')}</p>
        )}
        <p className="text-sm text-muted">
          {source.window.runs === 0
            ? t('sources.windowEmpty', { days: source.window.days })
            : [
                t('sources.window', {
                  days: source.window.days,
                  runs: formatNumber(source.window.runs),
                  read: formatNumber(source.window.read),
                  kept: formatNumber(source.window.kept),
                  fresh: formatNumber(source.window.fresh),
                  merged: formatNumber(source.window.merged),
                }),
                source.window.failed > 0
                  ? t('sources.windowFailed', { count: source.window.failed })
                  : null,
              ]
                .filter(Boolean)
                .join(', ')}
        </p>
        {source.quota ? (
          <p className="text-sm text-muted">
            {t('sources.quota', {
              remaining: formatNumber(source.quota.remaining),
              date: formatDate(source.quota.checkedAt),
            })}
          </p>
        ) : null}
        <p className="text-sm text-muted">
          {source.relevance.scored === 0
            ? t('sources.relevanceNone', { days: source.window.days })
            : t('sources.relevance', {
                percent: formatNumber(
                  Math.round((100 * source.relevance.top) / source.relevance.scored),
                ),
                top: formatNumber(source.relevance.top),
                scored: formatNumber(source.relevance.scored),
                days: source.window.days,
              })}
        </p>
        {source.runs.length > 1 ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-accent">
              {t('sources.history')}
            </summary>
            <ul className="mt-2 flex flex-col divide-y divide-line">
              {source.runs.slice(1).map((run) => (
                <li key={run.id} className="py-2">
                  <RunSummary run={run} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Card>
  );
}

function TestResult({ pass }: { pass: CollectionPass }) {
  const { t } = useTranslation();
  const pending = pass.status === 'queued' || pass.status === 'running';
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <p className="text-sm text-muted">
        {pending
          ? t('sources.testWaiting')
          : t('sources.testDone', { date: formatDateTime(pass.finishedAt ?? pass.createdAt) })}
      </p>
      {pass.status === 'interrupted' ? (
        <Alert tone="error">{t('sources.testInterrupted')}</Alert>
      ) : null}
      {pass.runs.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line">
          {pass.runs.map((run) => (
            <li key={run.id} className="flex flex-col gap-1 py-3">
              <span className="font-medium">
                {t(`sources.names.${run.source}`, { defaultValue: run.source })}
              </span>
              <RunSummary run={run} withDate={false} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The Sources screen (SPEC section 9): each source's switch and latest runs, and the test. */
export function SourcesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sources = useQuery(sourcesQuery);
  const latest = useQuery(latestTestQuery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pass = latest.data?.pass ?? null;
  const pending = pass?.status === 'queued' || pass?.status === 'running';

  // When a test ends, each card shows its new run.
  const seen = useRef(pass?.status);
  useEffect(() => {
    if (seen.current !== pass?.status && pass && !pending) {
      void queryClient.invalidateQueries({ queryKey: sourcesQuery.queryKey, exact: true });
    }
    seen.current = pass?.status;
  }, [pass, pending, queryClient]);

  const test = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<CollectionPass>('/api/sources/test', {});
      queryClient.setQueryData(latestTestQuery.queryKey, { pass: created });
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  const data = sources.data;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('sources.title')}</h1>
        <p className="text-muted">{t('sources.intro')}</p>
      </div>
      {sources.isError ? <Alert tone="error">{errorMessage(t, sources.error)}</Alert> : null}
      {data?.usageMode === 'commercial' ? <Alert>{t('sources.usageCommercial')}</Alert> : null}
      {data && data.sources.some((source) => source.alert) ? (
        <Alert tone="error" title={t('sources.alertBanner')}>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {data.sources.map((source) =>
              source.alert ? (
                <li key={source.name}>
                  {t(`sources.names.${source.name}`, { defaultValue: source.name })} :{' '}
                  {t(`sources.alerts.${source.alert.kind}`, {
                    date: formatDate(source.alert.since),
                    read: formatNumber(source.alert.read ?? 0),
                    usual: formatNumber(source.alert.usual ?? 0),
                  })}
                </li>
              ) : null,
            )}
          </ul>
        </Alert>
      ) : null}

      <Card aria-labelledby="sources-test-title">
        <div className="flex flex-col gap-3">
          <h2 id="sources-test-title" className="text-lg font-semibold">
            {t('sources.testTitle')}
          </h2>
          <p className="text-sm text-muted">{t('sources.testHint')}</p>
          <div>
            <Button
              onClick={() => void test()}
              loading={busy || pending}
              disabled={!data || data.sources.length === 0}
            >
              {pending ? t('sources.testing') : t('sources.test')}
            </Button>
          </div>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {pass ? <TestResult pass={pass} /> : null}
        </div>
      </Card>

      {data && data.sources.length === 0 ? (
        <p className="text-muted">{t('sources.empty')}</p>
      ) : null}
      {data?.sources.map((source) => (
        <SourceCard key={source.name} source={source} />
      ))}
    </div>
  );
}
