import {
  type Offer,
  type OfferPosting,
  type OfferUnmergeResponse,
  type ScoreAnalysis,
  scoringCriteria,
} from '@job4me/contracts';
import { formatDate } from '@job4me/i18n';
import { Alert, Badge, Button, Card, Spinner, TextAreaField, TextField } from '@job4me/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { benchmarksQuery } from '../../api/ai';
import { api } from '../../api/client';
import { offerQuery, safeLink } from '../../api/collect';
import { errorMessage } from '../../components/errors';
import { usePlaceLabel, useSourceNames } from './OffersPage';
import { OfferScoreBadge, useFactorLabels } from './score';

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

/** A list of the detailed analysis, when it has something to say. */
function Findings({ id, title, items }: { id: string; title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      <ul className="list-disc ps-5 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

/** Claude Sonnet's analysis (phase 3 plan, section 8): the grid, then what it found. */
function Analysis({ analysis }: { analysis: ScoreAnalysis }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-sm">
        <caption className="sr-only">{t('offer.analysis.grid')}</caption>
        <thead>
          <tr className="text-left text-muted">
            <th scope="col" className="py-1 font-medium">
              {t('offer.analysis.criterion')}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {t('offer.analysis.weight')}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {t('offer.analysis.subscore')}
            </th>
          </tr>
        </thead>
        <tbody>
          {scoringCriteria.map((criterion) => (
            <tr key={criterion} className="border-t border-line">
              <th scope="row" className="py-1 text-left font-normal">
                {t(`profile.scoringCriteria.${criterion}`)}
              </th>
              <td className="py-1 text-right">{analysis.weights[criterion]}</td>
              <td className="py-1 text-right font-semibold">{analysis.subscores[criterion]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Findings
        id="offer-analysis-blockers"
        title={t('offer.analysis.blockers')}
        items={analysis.blockers}
      />
      <Findings
        id="offer-analysis-strengths"
        title={t('offer.analysis.strengths')}
        items={analysis.strengths}
      />
      <Findings id="offer-analysis-gaps" title={t('offer.analysis.gaps')} items={analysis.gaps} />
      <Findings
        id="offer-analysis-keywords"
        title={t('offer.analysis.keywords')}
        items={analysis.keywords}
      />
    </div>
  );
}

/** The score with every factor that made it, and how far it can be trusted. */
function ScoreDetail({ score }: { score: NonNullable<OfferUnmergeResponse['offer']['score']> }) {
  const { t } = useTranslation();
  const label = useFactorLabels();
  const factors = score.factors.map(label).filter((text): text is string => Boolean(text));
  return (
    <div className="flex flex-col gap-2">
      <OfferScoreBadge score={score} />
      {score.reason ? <p className="text-sm">{score.reason}</p> : null}
      {factors.length > 0 ? (
        <ul className="list-disc ps-5 text-sm">
          {factors.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      ) : null}
      {score.analysis ? <Analysis analysis={score.analysis} /> : null}
      <p className="text-sm text-muted">
        {t(`offers.methods.${score.method}`)}
        {score.method !== 'rules' && score.confidence === 'low'
          ? ` ${t('offer.lowConfidence')}`
          : ''}
      </p>
    </div>
  );
}

/** « Ma note » (phase 3 plan, section 9): Mehdi's own rating, the reference set. */
function RatingSection({ offer }: { offer: Offer }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const reference = useQuery(benchmarksQuery);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const rating = offer.rating;

  const settle = async (updated: Offer, message: string) => {
    queryClient.setQueryData(offerQuery(offer.id).queryKey, updated);
    await queryClient.invalidateQueries({ queryKey: ['scoring', 'benchmarks'] });
    setEditing(false);
    setDone(message);
  };
  const open = () => {
    setValue(rating ? String(rating.value) : '');
    setNote(rating?.note ?? '');
    setDone(null);
    setError(null);
    setEditing(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.put<Offer>(`/api/offers/${offer.id}/rating`, {
        value: Number(value),
        note: note.trim() === '' ? null : note.trim(),
      });
      await settle(updated, t('offer.rating.saved'));
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await settle(
        await api.delete<Offer>(`/api/offers/${offer.id}/rating`),
        t('offer.rating.removed'),
      );
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card aria-labelledby="offer-rating-title">
      <div className="flex flex-col gap-3">
        <h2 id="offer-rating-title" className="text-lg font-semibold">
          {t('offer.rating.title')}
        </h2>
        <p className="text-sm text-muted">
          {t('offer.rating.intro', { goal: reference.data?.goal ?? 30 })}
        </p>
        {editing ? (
          <form onSubmit={(event) => void save(event)} className="flex flex-col gap-3">
            <TextField
              label={t('offer.rating.value')}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <TextAreaField
              label={t('offer.rating.note')}
              maxLength={200}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={busy}>
                {t('offer.rating.save')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                {t('offer.rating.cancel')}
              </Button>
            </div>
          </form>
        ) : rating ? (
          <div className="flex flex-col gap-2">
            <p className="font-semibold">{t('offer.rating.yours', { value: rating.value })}</p>
            {rating.note ? <p className="text-sm">{rating.note}</p> : null}
            {offer.score ? (
              <p className="text-sm text-muted">
                {t('offer.rating.gap', { gap: Math.abs(rating.value - offer.score.value) })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={open}>
                {t('offer.rating.edit')}
              </Button>
              <Button variant="secondary" loading={busy} onClick={() => void remove()}>
                {t('offer.rating.remove')}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="secondary" onClick={open}>
              {t('offer.rating.rate')}
            </Button>
          </div>
        )}
        {done ? (
          <p role="status" className="text-sm">
            {done}
          </p>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Card>
  );
}

/**
 * One announcement (ADR 0016): its score and what made it, Mehdi's own rating, its retained
 * posting, then every site that carries it, with "not the same offer" to undo a wrong merge.
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
            {data.score ? <ScoreDetail score={data.score} /> : null}
            {data.excluded ? (
              <Alert tone="info">
                {t('offers.excludedBecause', {
                  reason: t(`offers.exclusions.${data.excluded}`),
                })}
              </Alert>
            ) : null}
          </div>

          <RatingSection key={data.id} offer={data} />

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
