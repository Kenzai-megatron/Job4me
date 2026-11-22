import { Alert, Button } from '@job4me/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keywordRunQuery } from '../../api/ai';
import { api } from '../../api/client';
import type { KeywordRun } from '@job4me/contracts';
import { errorMessage } from '../../components/errors';

/** "Propose with the AI": the worker asks Claude, the keywords arrive as proposals to sort. */
export function KeywordProposer() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const latest = useQuery(keywordRunQuery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = latest.data?.run ?? null;
  const pending = run?.status === 'queued' || run?.status === 'running';

  // When the worker is done, the new proposals appear in the list.
  const seen = useRef(run?.status);
  useEffect(() => {
    if (seen.current !== run?.status && run?.status === 'done') {
      void queryClient.invalidateQueries({ queryKey: ['profile', 'rubric', 'keywords'] });
      void queryClient.invalidateQueries({ queryKey: ['profile', 'completeness'] });
    }
    seen.current = run?.status;
  }, [run?.status, queryClient]);

  const propose = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<KeywordRun>('/api/profile/keywords/propose');
      queryClient.setQueryData(keywordRunQuery.queryKey, { run: created });
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  let status: string | null = null;
  if (run?.status === 'queued') status = t('profile.keywordsAi.queued');
  if (run?.status === 'running') status = t('profile.keywordsAi.running');
  if (run?.status === 'done') status = t('profile.keywordsAi.done', { count: run.proposed });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">{t('profile.keywordsAi.hint')}</p>
      <div>
        <Button variant="secondary" loading={busy || pending} onClick={() => void propose()}>
          {t('profile.keywordsAi.propose')}
        </Button>
      </div>
      {status ? (
        <p role="status" className="text-sm">
          {status}
        </p>
      ) : null}
      {run?.status === 'failed' && run.errorCode ? (
        <Alert tone="error">{t(`profile.keywordsAi.failed.${run.errorCode}`)}</Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
    </div>
  );
}
