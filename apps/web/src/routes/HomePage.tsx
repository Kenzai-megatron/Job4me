import { Alert, Card } from '@job4me/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { securityQuery, sessionQuery } from '../api/queries';

export function HomePage() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  const security = useQuery(securityQuery);
  const needsTotp = security.data && !security.data.totpEnabled;
  const needsCodes = security.data && security.data.recoveryCodesRemaining === 0;

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
      <Card>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">
          {t('placeholder.comingInPhase', { phase: 3 })}
        </p>
        <p className="mt-2">{t('placeholder.home')}</p>
      </Card>
    </div>
  );
}
