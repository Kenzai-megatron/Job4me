import type { ManualOfferInput, ManualOfferResponse, Offer } from '@job4me/contracts';
import { formatDate } from '@job4me/i18n';
import { Alert, Button, Card, SelectField, TextAreaField, TextField } from '@job4me/ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { offersQuery, safeLink, sourcesQuery } from '../../api/collect';
import { errorMessage } from '../../components/errors';

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
  const link = safeLink(offer.url);
  return (
    <li className="flex flex-col gap-1 py-4">
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
          offer.location,
          sourceNames(offer),
          offer.postedOn
            ? t('offers.posted', { date: formatDate(offer.postedOn) })
            : t('offers.seen', { date: formatDate(offer.firstSeenAt) }),
        ].join(' · ')}
      </p>
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
 * Offers (phase 3 plan, section 10): one entry per announcement, newest first, with the sites that
 * carry it; scores come with lot 4.
 */
export function OffersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [source, setSource] = useState('');
  const sources = useQuery(sourcesQuery);
  const offers = useInfiniteQuery(offersQuery(source));
  const items = offers.data?.pages.flatMap((page) => page.offers) ?? [];
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

      <SelectField
        label={t('offers.filter')}
        value={source}
        onChange={(event) => setSource(event.target.value)}
        emptyLabel={t('offers.allSources')}
        options={names.map((name) => ({
          value: name,
          label: t(`sources.names.${name}`, { defaultValue: name }),
        }))}
        className="max-w-sm"
      />

      {offers.isError ? <Alert tone="error">{errorMessage(t, offers.error)}</Alert> : null}
      {offers.isSuccess && items.length === 0 ? (
        <p className="text-muted">{t('offers.empty')}</p>
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
