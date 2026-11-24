import {
  type CvContent,
  type CvElement,
  cvSectionKinds,
  documentTemplates,
  type MasterCv,
} from '@job4me/contracts';
import { formatDateTime } from '@job4me/i18n';
import {
  Alert,
  Button,
  Card,
  CheckboxField,
  SelectField,
  Spinner,
  TextAreaField,
} from '@job4me/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { documentVersionsQuery, masterCvQuery } from '../../api/documents';
import { errorMessage } from '../../components/errors';

/** The CV as it reads, before its PDF and DOCX (lot 2): every line from the profile. */
function CvPreview({ content }: { content: CvContent }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-xl font-bold">{content.title.text}</p>
        {content.summary ? <p className="text-sm">{content.summary.text}</p> : null}
      </div>
      {content.sections.map((section) => (
        <section key={section.kind} aria-label={t(`documents.sections.${section.kind}`)}>
          <h3 className="mb-2 border-b border-line pb-1 text-sm font-semibold uppercase tracking-wide">
            {t(`documents.sections.${section.kind}`)}
          </h3>
          <ul className="flex flex-col gap-2">
            {section.entries.map((entry) => (
              <li key={entry.key} className="flex flex-col gap-1">
                {entry.heading.text ? (
                  <p className="font-semibold">
                    {entry.heading.text}
                    {entry.meta ? (
                      <span className="font-normal text-muted">{` · ${entry.meta}`}</span>
                    ) : null}
                  </p>
                ) : null}
                {entry.lines.length > 0 ? (
                  <ul className="list-disc ps-5 text-sm">
                    {entry.lines.map((line) => (
                      <li key={line.key}>{line.text}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One element of the profile: shown or not, moved up or down among its siblings. */
function ElementRow({
  element,
  hidden,
  first,
  last,
  onToggle,
  onMove,
}: {
  element: CvElement;
  hidden: boolean;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CheckboxField
        label={element.label}
        checked={!hidden}
        onChange={onToggle}
        className="min-w-0 flex-1"
      />
      <Button
        variant="secondary"
        disabled={first}
        aria-label={t('documents.up', { label: element.label })}
        onClick={() => onMove(-1)}
      >
        {t('documents.upShort')}
      </Button>
      <Button
        variant="secondary"
        disabled={last}
        aria-label={t('documents.down', { label: element.label })}
        onClick={() => onMove(1)}
      >
        {t('documents.downShort')}
      </Button>
    </div>
  );
}

function Editor({
  cv,
  notice,
  onSaved,
}: {
  cv: MasterCv;
  /** Said after a save: kept by the page, the editor starting afresh on a new version. */
  notice: string | null;
  onSaved: (cv: MasterCv, notice: string) => void;
}) {
  const { t } = useTranslation();
  const versions = useQuery(documentVersionsQuery(cv.documentId));
  const [order, setOrder] = useState(() => cv.elements.map((element) => element.key));
  const [hidden, setHidden] = useState(
    () => new Set(cv.elements.filter((element) => element.hidden).map((element) => element.key)),
  );
  const [summary, setSummary] = useState(cv.layout.summary ?? '');
  const [template, setTemplate] = useState(cv.template);
  const [busy, setBusy] = useState<'save' | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byKey = new Map(cv.elements.map((element) => [element.key, element]));
  const group = (section: string, parent: string | null) =>
    order.filter((key) => {
      const element = byKey.get(key);
      return element?.section === section && element.parent === parent;
    });

  const move = (key: string, delta: -1 | 1) => {
    const element = byKey.get(key);
    if (!element) return;
    const siblings = group(element.section, element.parent);
    const other = siblings[siblings.indexOf(key) + delta];
    if (!other) return;
    setOrder((current) => {
      const next = [...current];
      const a = next.indexOf(key);
      const b = next.indexOf(other);
      next[a] = other;
      next[b] = key;
      return next;
    });
  };
  const toggle = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const run = async (kind: 'save' | 'refresh') => {
    setBusy(kind);
    setError(null);
    try {
      const saved =
        kind === 'save'
          ? await api.put<MasterCv>(`/api/master-cvs/${cv.id}`, {
              template,
              layout: {
                order,
                hidden: [...hidden],
                summary: summary.trim() === '' ? null : summary.trim(),
              },
            })
          : await api.post<MasterCv>(`/api/master-cvs/${cv.id}/refresh`);
      onSaved(
        saved,
        saved.version.number === cv.version.number
          ? t('documents.unchanged')
          : t('documents.saved', { version: saved.version.number }),
      );
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {cv.stale ? (
        <Alert tone="info" title={t('documents.staleTitle')}>
          <p>{t('documents.staleBody')}</p>
          <div className="mt-2">
            <Button
              variant="secondary"
              loading={busy === 'refresh'}
              onClick={() => void run('refresh')}
            >
              {t('documents.refresh')}
            </Button>
          </div>
        </Alert>
      ) : null}

      <Card aria-labelledby="master-cv-choices">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="master-cv-choices" className="text-lg font-semibold">
              {t('documents.choicesTitle')}
            </h2>
            <p className="text-sm text-muted">{t('documents.choicesIntro')}</p>
          </div>
          <SelectField
            label={t('documents.template')}
            value={template}
            onChange={(event) => setTemplate(event.target.value as MasterCv['template'])}
            options={documentTemplates.map((value) => ({
              value,
              label: t(`documents.templates.${value}`),
            }))}
            className="w-full max-w-xs"
          />
          <TextAreaField
            label={t('documents.summary')}
            hint={t('documents.summaryHint')}
            maxLength={600}
            rows={3}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
          {cvSectionKinds.map((section) => {
            const keys = group(section, null);
            if (keys.length === 0) return null;
            return (
              <section key={section} aria-labelledby={`master-cv-section-${section}`}>
                <h3 id={`master-cv-section-${section}`} className="mb-1 font-semibold">
                  {t(`documents.sections.${section}`)}
                </h3>
                <ul className="flex flex-col gap-1">
                  {keys.map((key, index) => {
                    const element = byKey.get(key);
                    if (!element) return null;
                    const children = group(section, key);
                    return (
                      <li key={key} className="flex flex-col gap-1">
                        <ElementRow
                          element={element}
                          hidden={hidden.has(key)}
                          first={index === 0}
                          last={index === keys.length - 1}
                          onToggle={() => toggle(key)}
                          onMove={(delta) => move(key, delta)}
                        />
                        {children.length > 0 ? (
                          <ul className="flex flex-col gap-1 border-s border-line ps-4">
                            {children.map((childKey, childIndex) => {
                              const child = byKey.get(childKey);
                              return child ? (
                                <li key={childKey}>
                                  <ElementRow
                                    element={child}
                                    hidden={hidden.has(childKey) || hidden.has(key)}
                                    first={childIndex === 0}
                                    last={childIndex === children.length - 1}
                                    onToggle={() => toggle(childKey)}
                                    onMove={(delta) => move(childKey, delta)}
                                  />
                                </li>
                              ) : null;
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <div className="flex flex-wrap items-center gap-3">
            <Button loading={busy === 'save'} onClick={() => void run('save')}>
              {t('documents.save')}
            </Button>
            {notice ? (
              <p role="status" className="text-sm">
                {notice}
              </p>
            ) : null}
          </div>
          {error ? <Alert tone="error">{error}</Alert> : null}
        </div>
      </Card>

      <Card aria-labelledby="master-cv-preview">
        <div className="flex flex-col gap-3">
          <h2 id="master-cv-preview" className="text-lg font-semibold">
            {t('documents.previewTitle', { version: cv.version.number })}
          </h2>
          <CvPreview content={cv.content} />
        </div>
      </Card>

      <Card aria-labelledby="master-cv-versions">
        <div className="flex flex-col gap-3">
          <h2 id="master-cv-versions" className="text-lg font-semibold">
            {t('documents.versionsTitle')}
          </h2>
          <ul className="flex flex-col divide-y divide-line">
            {(versions.data?.versions ?? []).map((version) => (
              <li key={version.number} className="py-2 text-sm">
                {t('documents.versionLine', {
                  version: version.number,
                  date: formatDateTime(version.createdAt),
                  origin: t(`documents.origins.${version.origin}`),
                })}
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}

/** The master CV of a target job: Mehdi's choices, the CV they give, its versions. */
export function MasterCvPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { masterCvId } = useParams({ strict: false });
  const id = masterCvId ?? '';
  const cv = useQuery({ ...masterCvQuery(id), enabled: id !== '' });
  const data = cv.data;
  const [notice, setNotice] = useState<string | null>(null);

  const saved = (next: MasterCv, message: string) => {
    setNotice(message);
    queryClient.setQueryData(masterCvQuery(id).queryKey, next);
    void queryClient.invalidateQueries({ queryKey: ['documents', 'versions', next.documentId] });
    void queryClient.invalidateQueries({ queryKey: ['documents', 'master-cvs'] });
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/documents"
        className="text-sm font-medium text-accent underline underline-offset-4"
      >
        {t('documents.back')}
      </Link>
      {cv.isPending && id !== '' ? <Spinner /> : null}
      {cv.isError ? <Alert tone="error">{errorMessage(t, cv.error)}</Alert> : null}
      {data ? (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {t('documents.masterOf', { job: data.targetJob })}
            </h1>
            <p className="text-muted">{t('documents.masterHint')}</p>
          </div>
          <Editor
            key={`${data.id}:${data.version.number}`}
            cv={data}
            notice={notice}
            onSaved={saved}
          />
        </>
      ) : null}
    </div>
  );
}
