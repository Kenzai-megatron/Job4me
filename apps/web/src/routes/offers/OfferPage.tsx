import type { OfferPosting, OfferUnmergeResponse } from '@job4me/contracts';
import { formatDate } from '@job4me/i18n';
import { Alert, Badge, Button, Card, Spinner } from '@job4me/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { offerQuery, safeLink } from '../../api/collect';
import { errorMessage } from '../../components/errors';
import { usePlaceLabel, useSourceNames } from './OffersPage';

/** When a posting was seen: one day, or from its first to its latest sighting. */
function seen(posting: OfferPosting, t: ReturnType<typeof useTranslation>['t']) {
  const first = formatDate(posting.firstSeenAt);
  const last = formatDate(posting.lastSeenAt);
  return first === last ? t('offer.seenOn', { date: first }) : t('offer.seenFrom', { first, last });
}

function PostingItem({
  posting,
  canUnmerge,
  busy,
  onUnmerge,
}: {
  posting: OfferPosting;
  canUnmerge: boolean;
  busy: boolean;
  onUnmerge: () => void;
}) {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const source = t(`sources.names.${posting.source}`, { defaultValue: posting.source });
  const link = safeLink(posting.url);
  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{source}</h3>
        {posting.mergeReason ? <Badge>{t(`offer.reasons.${posting.mergeReason}`)}</Badge> : null}
      </div>
      <p className="text-sm">{posting.title}</p>
      <p className="text-sm text-muted">
        {[
          posting.company,
          placeLabel(posting.place, posting.location, posting.remote),
          posting.postedOn ? t('offers.posted', { date: formatDate(posting.postedOn) }) : null,
          seen(posting, t),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-accent underline-offset-4 hover:underline"
          >
            {posting.origin === 'manual' ? t('offers.open') : t('offer.openOn', { source })}
          </a>
        ) : null}
        {canUnmerge ? (
          <Button variant="secondary" loading={busy} onClick={onUnmerge}>
            {t('offer.unmerge')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * One announcement (ADR 0016): its retained posting, then every site that carries it, with
 * "not the same offer" to undo a wrong merge. Scores and analysis come with lot 4.
 */
export function OfferPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sourceNames = useSourceNames();
  const placeLabel = usePlaceLabel();
  const { offerId } = useParams({ strict: false });
  const id = offerId ?? '';
  const offer = useQuery({ ...offerQuery(id), enabled: id !== '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detached, setDetached] = useState<OfferUnmergeResponse['detached'] | null>(null);
  const data = offer.data;

  const unmerge = async (postingId: string) => {
    setBusy(postingId);
    setError(null);
    setDetached(null);
    try {
      const result = await api.post<OfferUnmergeResponse>(`/api/offers/${id}/unmerge`, {
        postingId,
      });
      queryClient.setQueryData(offerQuery(id).queryKey, result.offer);
      setDetached(result.detached);
      await queryClient.invalidateQueries({ queryKey: ['offers'] });
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Link to="/offers" className="text-sm font-medium text-accent underline underline-offset-4">
        {t('offer.back')}
      </Link>
      {offer.isPending && id !== '' ? (
        <p role="status" className="flex items-center gap-2 text-muted">
          <Spinner />
          {t('common.loading')}
        </p>
      ) : null}
      {offer.isError ? <Alert tone="error">{errorMessage(t, offer.error)}</Alert> : null}
      {data ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{data.title}</h1>
            <p className="text-muted">
              {[
                data.company,
                placeLabel(data.place, data.location, data.remote),
                sourceNames(data),
                data.postedOn
                  ? t('offers.posted', { date: formatDate(data.postedOn) })
                  : t('offers.seen', { date: formatDate(data.firstSeenAt) }),
              ].join(' · ')}
            </p>
            {data.details || data.salary ? (
              <p className="text-sm">{[data.details, data.salary].filter(Boolean).join(' · ')}</p>
            ) : null}
          </div>

          <Card aria-labelledby="offer-description-title">
            <h2 id="offer-description-title" className="mb-2 text-lg font-semibold">
              {t('offer.description')}
            </h2>
            <p className="whitespace-pre-line text-sm">
              {data.description || t('offer.noDescription')}
            </p>
          </Card>

          <Card aria-labelledby="offer-postings-title">
            <div className="flex flex-col gap-1">
              <h2 id="offer-postings-title" className="text-lg font-semibold">
                {t('offer.postings', { count: data.postings.length })}
              </h2>
              {data.postings.length > 1 ? (
                <p className="text-sm text-muted">{t('offer.postingsHint')}</p>
              ) : null}
            </div>
            {detached ? (
              <p role="status" className="mt-3 text-sm">
                {t('offer.detached')}{' '}
                <Link
                  to="/offers/$offerId"
                  params={{ offerId: detached.id }}
                  className="font-semibold text-accent underline underline-offset-4"
                >
                  {t('offer.seeDetached')}
                </Link>
              </p>
            ) : null}
            {error ? (
              <div className="mt-3">
                <Alert tone="error">{error}</Alert>
              </div>
            ) : null}
            <ul className="flex flex-col divide-y divide-line">
              {data.postings.map((posting) => (
                <PostingItem
                  key={posting.id}
                  posting={posting}
                  canUnmerge={data.postings.length > 1}
                  busy={busy === posting.id}
                  onUnmerge={() => void unmerge(posting.id)}
                />
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </div>
  );
}
