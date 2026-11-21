import { Card } from '@job4me/ui';
import { useTranslation } from 'react-i18next';

export type Section = 'offers' | 'applications' | 'documents' | 'profile';

/** Sections built in later phases: what they will hold, and when. */
export function PlaceholderPage({ section, phase }: { section: Section; phase: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t(`nav.${section}`)}</h1>
      <Card>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">
          {t('placeholder.comingInPhase', { phase })}
        </p>
        <p className="mt-2">{t(`placeholder.${section}`)}</p>
      </Card>
    </div>
  );
}
