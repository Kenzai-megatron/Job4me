import type { OfferScore, ScoreFactor } from '@job4me/contracts';
import { formatNumber } from '@job4me/i18n';
import { ScoreBadge, scoreBand } from '@job4me/ui';
import { useTranslation } from 'react-i18next';

// A score as Mehdi reads it (phase 3 plan, section 10): the number, its band, and what made it,
// worded from the factors (the scoring without AI keeps them as data).

const BAND: Record<ReturnType<typeof scoreBand>, '80' | '60' | '40' | '0'> = {
  band80: '80',
  band60: '60',
  band40: '40',
  band0: '0',
};

export function OfferScoreBadge({ score }: { score: OfferScore }) {
  const { t } = useTranslation();
  return (
    <ScoreBadge score={score.value} label={t(`offers.bands.${BAND[scoreBand(score.value)]}`)} />
  );
}

/** Each factor in a few words: « intitulé proche de « Comptable » », « 12 km », « CDI ». */
export function useFactorLabels() {
  const { t } = useTranslation();
  const language = (code: string) => t(`offers.languages.${code}`, { defaultValue: code });
  return (factor: ScoreFactor): string | null => {
    switch (factor.kind) {
      case 'title':
        return t(`offers.factors.title.${factor.strength}`, { match: factor.match ?? '' });
      case 'skills':
        return t('offers.factors.skills', {
          count: factor.matched.length,
          list: factor.matched.join(', '),
        });
      case 'language':
        return factor.level
          ? t('offers.factors.language', { language: language(factor.code), level: factor.level })
          : t('offers.factors.languageMissing', { language: language(factor.code) });
      case 'distance':
        if (factor.remote === 'full') return t('offers.remote.full');
        if (factor.status === 'abroad') return t('offers.factors.abroad');
        if (factor.status === 'found' && factor.km !== null) {
          return t('offers.factors.km', { km: formatNumber(factor.km) });
        }
        return t('offers.factors.placeUnknown');
      case 'contract':
        return t(
          factor.wanted === false ? 'offers.factors.contractUnwanted' : 'offers.factors.contract',
          {
            contracts: factor.contracts
              .map((value) => t(`profile.options.contractTypes.${value}`))
              .join(', '),
          },
        );
      case 'regime':
        return factor.wanted
          ? null
          : t('offers.factors.regimeUnwanted', {
              regime: t(`profile.options.workRegimes.${factor.regime}`),
            });
      case 'freshness':
        return factor.days <= 3
          ? t('offers.factors.recent')
          : factor.days > 14
            ? t('offers.factors.old', { days: factor.days })
            : null;
      case 'sector':
        return t('offers.factors.sector', { sector: factor.sector });
      case 'rejected':
        return t('offers.factors.rejected', { expression: factor.expression });
    }
  };
}

/** The explanation of a score: Claude's reason, or the factors worded and joined. */
export function useScoreExplanation() {
  const label = useFactorLabels();
  return (score: OfferScore): string =>
    score.reason ??
    score.factors
      .map(label)
      .filter((text): text is string => Boolean(text))
      .join(' · ');
}
