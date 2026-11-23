import type { ImportReview, Proposal, ProposalRubric } from '@job4me/contracts';
import { formatDateTime } from '@job4me/i18n';
import { Alert, Badge, Button, Card, TextField } from '@job4me/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { rubricQuery } from '../../api/profile';
import { errorMessage } from '../../components/errors';
import { rubricSections } from './fields';
import { EntryForm } from './ListSection';

// Field-by-field review of an import (plan, section 7): each proposal shows the excerpt of the
// document it comes from; Mehdi accepts it, corrects it or sets it aside. Nothing else writes.

const ORDER: ProposalRubric[] = [
  'identity',
  'target-jobs',
  'experiences',
  'facts',
  'education',
  'certifications',
  'skills',
  'languages',
  'saved-offers',
  'past-applications',
];

/** Translation keys of the rubrics, as the profile page names them. */
const RUBRIC_KEYS: Record<ProposalRubric, string> = {
  identity: 'profile.rubrics.identity',
  'target-jobs': 'profile.rubrics.targetJobs',
  experiences: 'profile.rubrics.experiences',
  facts: 'profile.rubrics.facts',
  education: 'profile.rubrics.education',
  certifications: 'profile.rubrics.certifications',
  skills: 'profile.rubrics.skills',
  languages: 'profile.rubrics.languages',
  'saved-offers': 'review.rubrics.savedOffers',
  'past-applications': 'review.rubrics.pastApplications',
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function useSummary() {
  const { t } = useTranslation();
  return (proposal: Proposal): { title: string; detail?: string } => {
    const c = proposal.content;
    const join = (...parts: unknown[]) =>
      parts
        .map(text)
        .filter((part) => part !== '')
        .join(' · ');
    switch (proposal.rubric) {
      case 'identity':
        return { title: `${t(`review.fields.${text(c.field)}`)} : ${text(c.value)}` };
      case 'target-jobs':
        return { title: text(c.title) };
      case 'experiences':
        return {
          title: join(c.title, c.employer),
          detail: join(
            c.location,
            c.startMonth,
            c.current === true ? t('profile.current') : c.endMonth,
          ),
        };
      case 'facts':
        return { title: text(c.text) };
      case 'education':
        return {
          title: join(c.degree, c.institution),
          detail: typeof c.year === 'number' ? String(c.year) : undefined,
        };
      case 'certifications':
        return {
          title: join(c.name, c.issuer),
          detail: typeof c.year === 'number' ? String(c.year) : undefined,
        };
      case 'skills':
        return {
          title: text(c.name),
          detail: c.level ? t(`profile.options.skillLevels.${text(c.level)}`) : undefined,
        };
      case 'languages':
        return {
          title: t(`profile.options.languages.${text(c.language)}`, {
            defaultValue: text(c.language),
          }),
          detail: c.overall ? text(c.overall) : t('review.levelMissing'),
        };
      case 'saved-offers':
      case 'past-applications':
        return { title: t('review.history', { count: Array.isArray(c.rows) ? c.rows.length : 0 }) };
    }
  };
}

function IdentityCorrection({
  proposal,
  onSave,
  onDone,
}: {
  proposal: Proposal;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(text(proposal.content.value));
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await onSave({ value: value.trim() });
      onDone();
    } catch (caught) {
      setError(errorMessage(t, caught));
    }
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <TextField
        label={t(`review.fields.${text(proposal.content.field)}`)}
        value={value}
        required
        onChange={(event) => setValue(event.target.value)}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit">{t('review.keepCorrected')}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('profile.actions.cancel')}
        </Button>
      </div>
    </form>
  );
}

function ProposalCard({ importId, proposal }: { importId: string; proposal: Proposal }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const summary = useSummary()(proposal);
  const experiences = useQuery({
    ...rubricQuery('experiences'),
    enabled: proposal.rubric === 'facts',
  });
  const [correcting, setCorrecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const section = rubricSections.find((candidate) => candidate.slug === proposal.rubric);
  const needsLevel = proposal.rubric === 'languages' && !proposal.content.overall;
  const isHistory = proposal.rubric === 'saved-offers' || proposal.rubric === 'past-applications';

  const decide = async (decision: 'accept' | 'ignore', content?: Record<string, unknown>) => {
    await api.post(`/api/imports/${importId}/proposals/${proposal.id}/decision`, {
      decision,
      ...(content ? { content } : {}),
    });
    await queryClient.invalidateQueries({ queryKey: ['imports'] });
    await queryClient.invalidateQueries({ queryKey: ['profile'] });
  };
  const run = async (decision: 'accept' | 'ignore') => {
    setBusy(true);
    setError(null);
    try {
      await decide(decision);
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium break-words">{summary.title}</span>
        {proposal.duplicate ? <Badge>{t('review.duplicate')}</Badge> : null}
        {proposal.decision !== 'pending' ? (
          <Badge tone="accent">{t(`review.decisions.${proposal.decision}`)}</Badge>
        ) : null}
      </div>
      {summary.detail ? <span className="text-sm text-muted">{summary.detail}</span> : null}
      {proposal.content.evidence ? (
        <p className="text-sm text-muted">
          {t('review.evidence', { text: text(proposal.content.evidence) })}
        </p>
      ) : null}
      {proposal.decision === 'pending' && !correcting ? (
        <div className="flex flex-wrap gap-3">
          {!needsLevel ? (
            <Button loading={busy} onClick={() => void run('accept')}>
              {t(isHistory ? 'review.importHistory' : 'review.keep')}
            </Button>
          ) : null}
          {!isHistory && (section || proposal.rubric === 'identity') ? (
            <Button variant="secondary" onClick={() => setCorrecting(true)}>
              {t(needsLevel ? 'review.chooseLevel' : 'review.correct')}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={() => void run('ignore')}>
            {t('review.ignore')}
          </Button>
        </div>
      ) : null}
      {correcting && proposal.rubric === 'identity' ? (
        <IdentityCorrection
          proposal={proposal}
          onSave={(body) => decide('accept', body)}
          onDone={() => setCorrecting(false)}
        />
      ) : null}
      {correcting && section ? (
        <EntryForm
          section={section}
          item={{ ...proposal.content, id: proposal.id }}
          experiences={experiences.data?.items ?? []}
          onSave={(body) => decide('accept', body)}
          onDone={() => setCorrecting(false)}
        />
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
    </li>
  );
}

export function ImportReviewPage() {
  const { t } = useTranslation();
  const { importId } = useParams({ strict: false });
  const id = importId ?? '';
  const review = useQuery({
    queryKey: ['imports', id, 'proposals'],
    queryFn: () => api.get<ImportReview>(`/api/imports/${id}/proposals`),
    enabled: id !== '',
  });
  const data = review.data;
  const pending = data?.proposals.filter((proposal) => proposal.decision === 'pending').length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          to="/profile"
          className="text-sm font-medium text-accent underline underline-offset-4"
        >
          {t('review.back')}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('review.title')}</h1>
        {data ? (
          <p className="text-muted">
            {t('review.intro', {
              kind: t(`imports.kinds.${data.run.kind}`),
              date: formatDateTime(data.run.createdAt),
            })}
          </p>
        ) : null}
      </div>
      {review.isError ? <Alert tone="error">{errorMessage(t, review.error)}</Alert> : null}
      {data && data.run.errorCode ? (
        <Alert tone="info">
          {t(`imports.aiNotes.${data.run.errorCode}`, { defaultValue: '' })}
        </Alert>
      ) : null}
      {data && pending === 0 ? <Alert tone="info">{t('review.allDone')}</Alert> : null}
      {data && data.proposals.length === 0 ? (
        <p className="text-muted">{t('review.empty')}</p>
      ) : null}
      {ORDER.map((rubric) => {
        const items = data?.proposals.filter((proposal) => proposal.rubric === rubric) ?? [];
        if (items.length === 0) return null;
        const headingId = `review-${rubric}`;
        return (
          <Card key={rubric} aria-labelledby={headingId}>
            <div className="flex flex-col gap-1">
              <h2 id={headingId} className="text-lg font-semibold">
                {t(RUBRIC_KEYS[rubric])}
              </h2>
              <ul className="flex flex-col divide-y divide-line">
                {items.map((proposal) => (
                  <ProposalCard key={proposal.id} importId={id} proposal={proposal} />
                ))}
              </ul>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
