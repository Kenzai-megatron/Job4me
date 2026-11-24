import { Alert, Card } from '@job4me/ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { offersQuery, sourcesQuery } from '../api/collect';
import { securityQuery, sessionQuery } from '../api/queries';
import { OfferScoreBadge } from './offers/score';
import { usePlaceLabel } from './offers/OffersPage';

const TOP_SHOWN = 5;

/** The new offers of 80 or more of the week (phase 3 plan, section 10), the best first. */
function TopOffers() {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const top = useInfiniteQuery(offersQuery('', 'kept', { band: '80', fresh: true }));
  const offers = top.data?.pages[0]?.offers ?? [];
  return (
    <Card aria-labelledby="home-top-title">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="home-top-title" className="text-lg font-semibold">
            {t('home.topTitle')}
          </h2>
          <p className="text-sm text-muted">{t('home.topIntro')}</p>
        </div>
        {top.isSuccess && offers.length === 0 ? (
          <p className="text-sm">{t('home.topEmpty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {offers.slice(0, TOP_SHOWN).map((offer) => (
              <li key={offer.id} className="flex flex-col gap-1 py-3">
                {offer.score ? <OfferScoreBadge score={offer.score} /> : null}
                <Link
                  to="/offers/$offerId"
                  params={{ offerId: offer.id }}
                  className="font-semibold underline-offset-4 hover:underline"
                >
                  {offer.title}
                </Link>
                <span className="text-sm text-muted">
                  {[offer.company, placeLabel(offer.place, offer.location, offer.remote)].join(
                    ' · ',
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link
          to="/offers"
          className="self-start text-sm font-semibold text-accent underline underline-offset-4"
        >
          {t('home.topAll')}
        </Link>
      </div>
    </Card>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  const security = useQuery(securityQuery);
  const needsTotp = security.data && !security.data.totpEnabled;
  const needsCodes = security.data && security.data.recoveryCodesRemaining === 0;
  // Silent sources (decision D4): also told here, the screen opened first.
  const sources = useQuery(sourcesQuery);
  const silent = sources.data?.sources.filter((source) => source.alert) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
        {t('home.welcome', { name: session.data?.user?.displayName ?? '' })}
      </h1>
      {needsTotp || needsCodes ? (
        <Alert title={t('home.setupTitle')}>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {needsTotp ? <li>{t('home.setupTotp')}</li> : null}
            {needsCodes ? <li>{t('home.setupCodes')}</li> : null}
          </ul>
          <Link
            to="/settings/security"
            className="mt-2 inline-block font-semibold text-accent underline underline-offset-4"
          >
            {t('home.setupLink')}
          </Link>
        </Alert>
      ) : null}
      {silent.length > 0 ? (
        <Alert tone="error" title={t('home.silentTitle')}>
          <p>
            {t('home.silentBody', {
              sources: silent
                .map((source) => t(`sources.names.${source.name}`, { defaultValue: source.name }))
                .join(', '),
            })}
          </p>
          <Link
            to="/sources"
            className="mt-2 inline-block font-semibold text-accent underline underline-offset-4"
          >
            {t('home.silentLink')}
          </Link>
        </Alert>
      ) : null}
      <TopOffers />
      <Card>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">
          {t('placeholder.comingInPhase', { phase: 5 })}
        </p>
        <p className="mt-2">{t('placeholder.home')}</p>
      </Card>
    </div>
  );
}
