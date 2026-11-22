import type { CompletenessRubric } from '@job4me/contracts';
import { Card } from '@job4me/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { completenessQuery } from '../../api/profile';
import { IdentitySection, MotivationsSection, PracticalSection } from './DocumentSections';
import { ImportsSection } from './ImportsSection';
import { rubricSections } from './fields';
import { ListSection } from './ListSection';

/** Where each completeness rubric is filled in on the page. */
const anchors: Record<CompletenessRubric, string> = {
  identity: 'profile-identity',
  practical: 'profile-practical',
  motivations: 'profile-motivations',
  targetJobs: 'rubric-target-jobs',
  keywords: 'rubric-keywords',
  experiences: 'rubric-experiences',
  facts: 'rubric-facts',
  skills: 'rubric-skills',
  languages: 'rubric-languages',
  education: 'rubric-education',
};

function CompletenessCard() {
  const { t } = useTranslation();
  const completeness = useQuery(completenessQuery);
  if (!completeness.data) return null;
  const { percent, rubrics } = completeness.data;
  const missing = rubrics.filter((rubric) => !rubric.done);
  return (
    <Card aria-labelledby="completeness-title">
      <div className="flex flex-col gap-3">
        <h2 id="completeness-title" className="text-lg font-semibold">
          {t('profile.completeness.title')}
        </h2>
        <p className="text-2xl font-bold tabular-nums">
          {t('profile.completeness.percent', { percent })}
        </p>
        <div
          role="progressbar"
          aria-label={t('profile.completeness.title')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 overflow-hidden rounded-full bg-line"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
        {missing.length === 0 ? (
          <p className="text-sm text-muted">{t('profile.completeness.complete')}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">{t('profile.completeness.missing')}</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {missing.map((rubric) => (
                <li key={rubric.rubric}>
                  <a
                    href={`#${anchors[rubric.rubric]}`}
                    className="text-sm font-medium text-accent underline underline-offset-4"
                  >
                    {t('profile.completeness.item', {
                      rubric: t(`profile.rubrics.${rubric.rubric}`),
                      count: rubric.count,
                      min: rubric.min,
                    })}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

export function ProfilePage() {
  const { t } = useTranslation();
  const completeness = useQuery(completenessQuery);
  const keywords = completeness.data?.rubrics.find((rubric) => rubric.rubric === 'keywords');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('profile.title')}</h1>
        <p className="text-muted">{t('profile.intro')}</p>
      </div>
      <CompletenessCard />
      <ImportsSection />
      <IdentitySection />
      <PracticalSection />
      <MotivationsSection />
      {rubricSections.map((section) => (
        <ListSection
          key={section.slug}
          section={section}
          advice={
            section.slug === 'keywords' && keywords
              ? t('profile.keywordsAdvice', { count: keywords.count, min: keywords.min })
              : undefined
          }
        />
      ))}
    </div>
  );
}
