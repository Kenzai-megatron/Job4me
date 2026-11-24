import type {
  ManualOfferInput,
  ManualOfferResponse,
  Offer,
  OfferPosting,
  OfferView,
  RemoteMode,
} from '@job4me/contracts';
import { formatDate, formatNumber } from '@job4me/i18n';
import {
  Alert,
  Button,
  Card,
  CheckboxField,
  SelectField,
  TextAreaField,
  TextField,
} from '@job4me/ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { offersQuery, safeLink, sourcesQuery } from '../../api/collect';
import { errorMessage } from '../../components/errors';
import { OfferScoreBadge, useScoreExplanation } from './score';

const EMPTY = { title: '', url: '', company: '', location: '', text: '' };

/**
 * "Add an offer": a link and the text pasted; the server stores the link, never opens it. An
 * offer already collected gets the posting added by hand (ADR 0016).
 */
function AddOffer({ onAdded }: { onAdded: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ManualOfferResponse | null>(null);
  const set = (field: keyof typeof EMPTY) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    const body: ManualOfferInput = {
      title: values.title,
      url: values.url.trim() || null,
      company: values.company.trim() || null,
      location: values.location.trim() || null,
      text: values.text.trim() || null,
    };
    try {
      setDone(await api.post<ManualOfferResponse>('/api/offers', body));
      setValues(EMPTY);
      setOpen(false);
      onAdded();
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            {t('offers.add.open')}
          </Button>
        </div>
        {done ? (
          <p role="status" className="text-sm">
            {done.merged ? (
              <>
                {t('offers.add.merged')}{' '}
                <Link
                  to="/offers/$offerId"
                  params={{ offerId: done.offer.id }}
                  className="font-semibold text-accent underline underline-offset-4"
                >
                  {t('offers.add.see')}
                </Link>
              </>
            ) : (
              t('offers.add.added')
            )}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <Card aria-labelledby="offer-add-title">
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <div className="flex flex-col gap-1">
          <h2 id="offer-add-title" className="text-lg font-semibold">
            {t('offers.add.title')}
          </h2>
          <p className="text-sm text-muted">{t('offers.add.hint')}</p>
        </div>
        <TextField
          label={t('offers.add.titleField')}
          value={values.title}
          onChange={(event) => set('title')(event.target.value)}
          required
          maxLength={300}
        />
        <TextField
          label={t('offers.add.url')}
          type="url"
          inputMode="url"
          value={values.url}
          onChange={(event) => set('url')(event.target.value)}
          maxLength={2000}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('offers.add.company')}
            value={values.company}
            onChange={(event) => set('company')(event.target.value)}
            maxLength={200}
          />
          <TextField
            label={t('offers.add.location')}
            value={values.location}
            onChange={(event) => set('location')(event.target.value)}
            maxLength={200}
          />
        </div>
        <TextAreaField
          label={t('offers.add.text')}
          value={values.text}
          onChange={(event) => set('text')(event.target.value)}
          rows={6}
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>
            {t('offers.add.submit')}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Where an offer is (ADR 0017): the locality and its road distance from the base city, the place
 * as written when it is abroad or unknown, and the remote work it announces.
 */
export function usePlaceLabel() {
  const { t } = useTranslation();
  return (
    place: OfferPosting['place'] & { distanceKm?: number | null },
    location: string,
    remote: RemoteMode | null,
  ) => {
    const where =
      place.status === 'found' && place.name
        ? typeof place.distanceKm === 'number'
          ? t('offers.place.distance', { name: place.name, km: formatNumber(place.distanceKm) })
          : place.name
        : place.status === 'abroad'
          ? t('offers.place.abroad', { location })
          : location === '?'
            ? t('offers.place.unknown')
            : location;
    return remote ? `${where} · ${t(`offers.remote.${remote}`)}` : where;
  };
}

/** The sites that carry an announcement, each named once, the retained one first. */
export function useSourceNames() {
  const { t } = useTranslation();
  return (offer: Offer) =>
    [...new Set(offer.postings.map((posting) => posting.source))]
      .map((source) => t(`sources.names.${source}`, { defaultValue: source }))
      .join(', ');
}

/** One announcement (ADR 0016): its retained posting, and every site that carries it. */
function OfferItem({ offer }: { offer: Offer }) {
  const { t } = useTranslation();
  const sourceNames = useSourceNames();
  const placeLabel = usePlaceLabel();
  const explain = useScoreExplanation();
  const link = safeLink(offer.url);
  return (
    <li className="flex flex-col gap-1 py-4">
      {offer.score ? (
        <div className="flex flex-wrap items-center gap-2">
          <OfferScoreBadge score={offer.score} />
          <span className="text-sm text-muted">{explain(offer.score)}</span>
        </div>
      ) : null}
      <h3 className="font-semibold">
        <Link
          to="/offers/$offerId"
          params={{ offerId: offer.id }}
          className="underline-offset-4 hover:underline"
        >
          {offer.title}
        </Link>
      </h3>
      <p className="text-sm text-muted">
        {[
          offer.company,
          placeLabel(offer.place, offer.location, offer.remote),
          sourceNames(offer),
          offer.postedOn
            ? t('offers.posted', { date: formatDate(offer.postedOn) })
            : t('offers.seen', { date: formatDate(offer.firstSeenAt) }),
        ].join(' · ')}
      </p>
      {offer.excluded ? (
        <p className="text-sm font-medium">
          {t('offers.excludedBecause', { reason: t(`offers.exclusions.${offer.excluded}`) })}
        </p>
      ) : null}
      {offer.postings.length > 1 ? (
        <p className="text-sm">{t('offers.postingCount', { count: offer.postings.length })}</p>
      ) : null}
      {offer.details || offer.salary ? (
        <p className="text-sm">{[offer.details, offer.salary].filter(Boolean).join(' · ')}</p>
      ) : null}
      {offer.description ? <p className="line-clamp-3 text-sm">{offer.description}</p> : null}
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start text-sm font-semibold text-accent underline-offset-4 hover:underline"
        >
          {t('offers.open')}
        </a>
      ) : null}
    </li>
  );
}

/**
 * Offers (phase 3 plan, section 10): one entry per announcement, by score then the freshest, with
 * its band and what made it, and the sites that carry it.
 */
export function OffersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [source, setSource] = useState('');
  const [view, setView] = useState<OfferView>('kept');
  const [band, setBand] = useState('');
  const [fresh, setFresh] = useState(false);
  const sources = useQuery(sourcesQuery);
  const offers = useInfiniteQuery(offersQuery(source, view, { band, fresh }));
  const items = offers.data?.pages.flatMap((page) => page.offers) ?? [];
  const counts = offers.data?.pages[0]?.counts;
  const names = [...(sources.data?.sources.map((item) => item.name) ?? []), 'manual'];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('offers.title')}</h1>
          <p className="text-muted">{t('offers.intro')}</p>
        </div>
        <Link
          to="/sources"
          className="inline-flex min-h-11 items-center rounded-md px-4 font-semibold text-accent hover:bg-accent-soft"
        >
          {t('offers.sources')}
        </Link>
      </div>

      <AddOffer onAdded={() => void queryClient.invalidateQueries({ queryKey: ['offers'] })} />

      <div className="flex flex-wrap items-end gap-4">
        <SelectField
          label={t('offers.filter')}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          emptyLabel={t('offers.allSources')}
          options={names.map((name) => ({
            value: name,
            label: t(`sources.names.${name}`, { defaultValue: name }),
          }))}
          className="w-full max-w-xs"
        />
        <SelectField
          label={t('offers.bandFilter')}
          value={band}
          onChange={(event) => setBand(event.target.value)}
          emptyLabel={t('offers.allBands')}
          options={(['80', '60', '40', '0'] as const).map((value) => ({
            value,
            label: t(`offers.bandOptions.${value}`),
          }))}
          className="w-full max-w-xs"
        />
        <CheckboxField
          label={t('offers.fresh')}
          checked={fresh}
          onChange={(event) => setFresh(event.target.checked)}
        />
      </div>

      {/* The deterministic filter (phase 3 plan, section 6): what it keeps, what it sets aside. */}
      <div role="group" aria-label={t('offers.views.label')} className="flex flex-wrap gap-2">
        {(['kept', 'excluded'] as const).map((name) => (
          <Button
            key={name}
            variant={view === name ? 'primary' : 'secondary'}
            aria-pressed={view === name}
            onClick={() => setView(name)}
          >
            {counts
              ? t(`offers.views.${name}Count`, { count: counts[name] })
              : t(`offers.views.${name}`)}
          </Button>
        ))}
      </div>
      {view === 'excluded' ? <p className="text-sm text-muted">{t('offers.views.hint')}</p> : null}

      {offers.isError ? <Alert tone="error">{errorMessage(t, offers.error)}</Alert> : null}
      {offers.isSuccess && items.length === 0 ? (
        <p className="text-muted">
          {view === 'excluded' ? t('offers.emptyExcluded') : t('offers.empty')}
        </p>
      ) : null}
      {items.length > 0 ? (
        <Card aria-labelledby="offers-list-title">
          <h2 id="offers-list-title" className="sr-only">
            {t('offers.list')}
          </h2>
          <ul className="flex flex-col divide-y divide-line">
            {items.map((offer) => (
              <OfferItem key={offer.id} offer={offer} />
            ))}
          </ul>
        </Card>
      ) : null}
      {offers.hasNextPage ? (
        <div>
          <Button
            variant="secondary"
            loading={offers.isFetchingNextPage}
            onClick={() => void offers.fetchNextPage()}
          >
            {t('offers.more')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
