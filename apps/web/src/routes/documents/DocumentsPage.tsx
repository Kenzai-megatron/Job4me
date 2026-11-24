import type { MasterCv } from '@job4me/contracts';
import { formatDateTime } from '@job4me/i18n';
import { Alert, Button, Card } from '@job4me/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { masterCvsQuery } from '../../api/documents';
import { errorMessage } from '../../components/errors';

/**
 * Documents (phase 4 plan, section 7): a master CV per target job, built from the profile without
 * AI; the dossiers of the offers come with lot 3.
 */
export function DocumentsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery(masterCvsQuery);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = list.data?.masterCvs ?? [];

  const create = async (targetJobId: string) => {
    setBusy(targetJobId);
    setError(null);
    try {
      const cv = await api.post<MasterCv>('/api/master-cvs', { targetJobId });
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      await navigate({ to: '/documents/cv/$masterCvId', params: { masterCvId: cv.id } });
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('documents.title')}</h1>
        <p className="text-muted">{t('documents.intro')}</p>
      </div>
      {list.isError ? <Alert tone="error">{errorMessage(t, list.error)}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Card aria-labelledby="documents-master-title">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="documents-master-title" className="text-lg font-semibold">
              {t('documents.masterTitle')}
            </h2>
            <p className="text-sm text-muted">{t('documents.masterIntro')}</p>
          </div>
          {list.isSuccess && items.length === 0 ? (
            <p className="text-sm">
              {t('documents.noTargetJob')}{' '}
              <Link
                to="/profile"
                className="font-semibold text-accent underline underline-offset-4"
              >
                {t('documents.toProfile')}
              </Link>
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {items.map((item) => (
                <li
                  key={item.targetJobId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold">{item.targetJob}</span>
                    <span className="text-sm text-muted">
                      {item.id && item.version && item.updatedAt
                        ? t('documents.versionAt', {
                            version: item.version,
                            date: formatDateTime(item.updatedAt),
                          })
                        : t('documents.noMasterCv')}
                    </span>
                  </div>
                  {item.id ? (
                    <Link
                      to="/documents/cv/$masterCvId"
                      params={{ masterCvId: item.id }}
                      className="inline-flex min-h-11 items-center rounded-md px-4 font-semibold text-accent hover:bg-accent-soft"
                    >
                      {t('documents.open')}
                    </Link>
                  ) : (
                    <Button
                      variant="secondary"
                      loading={busy === item.targetJobId}
                      onClick={() => void create(item.targetJobId)}
                    >
                      {t('documents.create')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
