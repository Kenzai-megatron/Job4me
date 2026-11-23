import {
  Alert,
  Badge,
  Button,
  CheckboxField,
  SelectField,
  TextAreaField,
  TextField,
} from '@job4me/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { type RubricItem, rubricQuery } from '../../api/profile';
import { errorMessage } from '../../components/errors';
import type { FieldDef, RubricSection } from './fields';
import { ProfileSection } from './ProfileSection';

type FormValues = Record<string, string | boolean>;

/** Form values (strings and booleans) from an entry, or empty ones for a new entry. */
function toForm(fields: FieldDef[], item?: RubricItem): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    const value = item?.[field.name];
    if (field.kind === 'checkbox') values[field.name] = value === true;
    else
      values[field.name] =
        typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }
  return values;
}

/** The API body from form values: empty optional values become null, numbers become numbers. */
function toBody(fields: FieldDef[], values: FormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.kind === 'checkbox') {
      body[field.name] = value === true;
      continue;
    }
    const text = typeof value === 'string' ? value.trim() : '';
    if (text === '') body[field.name] = null;
    else body[field.name] = field.kind === 'number' ? Number(text) : text;
  }
  return body;
}

/** The form of one entry; `onSave` replaces the profile route (the import review uses it). */
export function EntryForm({
  section,
  item,
  experiences,
  onDone,
  onSave,
}: {
  section: RubricSection;
  item?: RubricItem;
  experiences: RubricItem[];
  onDone: () => void;
  onSave?: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormValues>(() => toForm(section.fields, item));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (name: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [name]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = toBody(section.fields, values);
      if (onSave) await onSave(body);
      else if (item) await api.patch(`/api/profile/${section.slug}/${item.id}`, body);
      else await api.post(`/api/profile/${section.slug}`, body);
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      onDone();
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  const optionsOf = (field: FieldDef) => {
    if (field.experienceOptions) {
      return experiences.map((experience) => ({
        value: experience.id,
        label: `${String(experience.title)} · ${String(experience.employer)}`,
      }));
    }
    return (field.options ?? []).map((value) => ({
      value,
      label: field.rawOptions ? value : t(`profile.options.${field.optionSet}.${value}`),
    }));
  };

  return (
    <form
      className="flex flex-col gap-4 rounded-md border border-line p-4"
      onSubmit={(event) => void submit(event)}
    >
      {section.fields.map((field) => {
        const label = t(`profile.fields.${field.name}`);
        const value = values[field.name];
        if (field.kind === 'checkbox') {
          return (
            <CheckboxField
              key={field.name}
              label={label}
              checked={value === true}
              onChange={(event) => set(field.name, event.target.checked)}
            />
          );
        }
        const text = typeof value === 'string' ? value : '';
        if (field.kind === 'select') {
          return (
            <SelectField
              key={field.name}
              label={label}
              required={field.required}
              options={optionsOf(field)}
              emptyLabel={field.required ? t('profile.choose') : t('profile.none')}
              value={text}
              onChange={(event) => set(field.name, event.target.value)}
            />
          );
        }
        if (field.kind === 'textarea') {
          return (
            <TextAreaField
              key={field.name}
              label={label}
              required={field.required}
              value={text}
              onChange={(event) => set(field.name, event.target.value)}
            />
          );
        }
        return (
          <TextField
            key={field.name}
            label={label}
            required={field.required}
            type={field.kind === 'number' ? 'number' : field.kind === 'month' ? 'month' : 'text'}
            inputMode={field.kind === 'number' ? 'decimal' : undefined}
            min={field.min}
            max={field.max}
            step={field.step}
            hint={field.kind === 'month' ? t('profile.hints.month') : undefined}
            value={text}
            onChange={(event) => set(field.name, event.target.value)}
          />
        );
      })}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={busy}>
          {t('profile.actions.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('profile.actions.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** One list rubric of the profile: its entries, and the forms to add, change or remove one. */
export function ListSection({
  section,
  advice,
  extra,
}: {
  section: RubricSection;
  /** A line under the intro, such as the advised number of keywords. */
  advice?: string;
  /** Something more above the entries, such as the AI proposal of keywords. */
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const entries = useQuery(rubricQuery(section.slug));
  const needsExperiences = section.fields.some((field) => field.experienceOptions);
  const experiences = useQuery({ ...rubricQuery('experiences'), enabled: needsExperiences });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const experienceList = experiences.data?.items ?? [];

  const display = (item: RubricItem, name: string): string | null => {
    const field = section.fields.find((candidate) => candidate.name === name);
    const value = item[name];
    if (value === null || value === undefined || value === '' || value === false) return null;
    if (field?.experienceOptions) {
      const experience = experienceList.find((candidate) => candidate.id === value);
      return experience ? String(experience.title) : null;
    }
    if (field?.optionSet && typeof value === 'string') {
      return t(`profile.options.${field.optionSet}.${value}`);
    }
    if (field?.kind === 'month' && typeof value === 'string') {
      const [year, month] = value.split('-');
      return `${month}/${year}`;
    }
    if (name === 'years') return t('profile.yearsValue', { count: Number(value) });
    return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  };
  const line = (item: RubricItem, names: string[] | undefined) =>
    (names ?? [])
      .map((name) => display(item, name))
      .filter((part): part is string => part !== null)
      .join(' · ');

  const change = async (task: () => Promise<unknown>) => {
    setError(null);
    try {
      await task();
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
    } catch (caught) {
      setError(errorMessage(t, caught));
    }
  };

  const items = (entries.data?.items ?? []).filter((item) => item.status !== 'rejected');

  return (
    <ProfileSection
      id={`rubric-${section.slug}`}
      title={t(`profile.rubrics.${section.key}`)}
      intro={t(`profile.intros.${section.key}`)}
    >
      {advice ? <p className="text-sm text-muted">{advice}</p> : null}
      {extra}
      {items.length === 0 && !adding ? (
        <p className="text-sm text-muted">{t('profile.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((item) =>
            editing === item.id ? (
              <li key={item.id} className="py-3">
                <EntryForm
                  section={section}
                  item={item}
                  experiences={experienceList}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium break-words">{line(item, section.title)}</span>
                  {section.detail ? (
                    <span className="text-sm text-muted">{line(item, section.detail)}</span>
                  ) : null}
                </div>
                {item.priority === true ? <Badge>{t('profile.priority')}</Badge> : null}
                {item.current === true ? <Badge>{t('profile.current')}</Badge> : null}
                {item.status === 'proposed' ? (
                  <>
                    <Badge>{t('profile.proposed')}</Badge>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void change(() =>
                          api.patch(`/api/profile/${section.slug}/${item.id}`, {
                            status: 'validated',
                          }),
                        )
                      }
                    >
                      {t('profile.actions.keep')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void change(() =>
                          api.patch(`/api/profile/${section.slug}/${item.id}`, {
                            status: 'rejected',
                          }),
                        )
                      }
                    >
                      {t('profile.actions.reject')}
                    </Button>
                  </>
                ) : null}
                <Button variant="ghost" onClick={() => setEditing(item.id)}>
                  {t('profile.actions.edit')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void change(() => api.delete(`/api/profile/${section.slug}/${item.id}`))
                  }
                >
                  {t('profile.actions.delete')}
                </Button>
              </li>
            ),
          )}
        </ul>
      )}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {adding ? (
        <EntryForm section={section} experiences={experienceList} onDone={() => setAdding(false)} />
      ) : (
        <div>
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t('profile.actions.add')}
          </Button>
        </div>
      )}
    </ProfileSection>
  );
}
