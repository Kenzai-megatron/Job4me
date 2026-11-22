import type { ImportRun } from '@job4me/contracts';
import { formatDateTime, formatNumber } from '@job4me/i18n';
import { Alert, Badge, Button } from '@job4me/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { importsQuery } from '../../api/imports';
import { errorMessage } from '../../components/errors';
import { ProfileSection } from './ProfileSection';

function RunDetails({ run }: { run: ImportRun }) {
  const { t } = useTranslation();
  const parts = [t('imports.when', { date: formatDateTime(run.createdAt) })];
  parts.push(
    t('imports.size', { size: formatNumber(Math.max(1, Math.round(run.sizeBytes / 1024))) }),
  );
  if (run.stats?.pages !== undefined) parts.push(t('imports.pages', { count: run.stats.pages }));
  if (run.stats?.characters !== undefined) {
    parts.push(t('imports.characters', { count: formatNumber(run.stats.characters) }));
  }
  if (run.stats?.rows) {
    const rows = Object.values(run.stats.rows).reduce((sum, count) => sum + count, 0);
    parts.push(t('imports.rows', { count: rows }));
  }
  return <span className="text-sm text-muted">{parts.join(' · ')}</span>;
}

/** Upload of a CV or of the LinkedIn archive, and the state of the recent imports. */
export function ImportsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const imports = useQuery(importsQuery);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await api.upload('/api/imports', file);
      setSent(true);
      setFile(null);
      if (input.current) input.current.value = '';
      await queryClient.invalidateQueries({ queryKey: ['imports'] });
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  const runs = imports.data?.items ?? [];

  return (
    <ProfileSection id="profile-imports" title={t('imports.title')} intro={t('imports.intro')}>
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="font-medium">
            {t('imports.file')}
          </label>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept=".pdf,.docx,.zip,application/pdf,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-describedby={hintId}
            className="text-base file:mr-3 file:min-h-11 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-4 file:font-semibold"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setSent(false);
              setError(null);
            }}
          />
          <p id={hintId} className="text-sm text-muted">
            {t('imports.fileHint')}
          </p>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {sent ? <Alert tone="info">{t('imports.sent')}</Alert> : null}
        <div>
          <Button type="submit" loading={busy} disabled={!file}>
            {t('imports.send')}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">{t('imports.history')}</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-muted">{t('imports.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" aria-live="polite">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t(`imports.kinds.${run.kind}`)}</span>
                  <Badge tone={run.status === 'failed' ? 'neutral' : 'accent'}>
                    {t(`imports.statuses.${run.status}`)}
                  </Badge>
                </div>
                <RunDetails run={run} />
                {run.status === 'failed' && run.errorCode ? (
                  <p className="text-sm text-danger">{t(`imports.failures.${run.errorCode}`)}</p>
                ) : null}
                {run.status === 'review' ? (
                  <>
                    <p className="text-sm">
                      {t('imports.proposals', { count: run.stats?.proposals ?? 0 })}
                    </p>
                    {run.errorCode ? (
                      <p className="text-sm text-muted">{t(`imports.aiNotes.${run.errorCode}`)}</p>
                    ) : null}
                    <p className="text-sm text-muted">{t('imports.nextStep')}</p>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ProfileSection>
  );
}
