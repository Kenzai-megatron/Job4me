import {
  contractTypes,
  eliminationKinds,
  keywordLanguages,
  type ProfileRubric,
  remotePreferences,
  sectorKinds,
  skillLevels,
  titleFilterLists,
  transportModes,
  workRegimes,
} from '@job4me/contracts';

// How each list rubric shows in the interface: its fields, in order, and how an entry reads.
// Labels come from the translation files (profile.fields.<name>, profile.options.<set>.<value>).

export const spokenLanguages = ['fr', 'nl', 'en', 'de', 'es', 'it', 'pt', 'ar', 'tr', 'pl', 'ro'];
export const cefr = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export type FieldKind = 'text' | 'textarea' | 'number' | 'month' | 'select' | 'checkbox';

export interface FieldDef {
  name: string;
  kind: FieldKind;
  required?: boolean;
  /** Choices of a select: their values, and the translation set of their labels. */
  options?: readonly string[];
  optionSet?: string;
  /** Labels are the values themselves (CEFR levels). */
  rawOptions?: boolean;
  /** The experiences of the profile (a fact may point to one). */
  experienceOptions?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface RubricSection {
  slug: ProfileRubric;
  /** Key under profile.rubrics and profile.intros. */
  key: string;
  fields: FieldDef[];
  /** The fields that make the title, then the detail, of an entry. */
  title: string[];
  detail?: string[];
}

export const rubricSections: RubricSection[] = [
  {
    slug: 'target-jobs',
    key: 'targetJobs',
    fields: [{ name: 'title', kind: 'text', required: true }],
    title: ['title'],
  },
  {
    slug: 'keywords',
    key: 'keywords',
    fields: [
      { name: 'keyword', kind: 'text', required: true },
      {
        name: 'language',
        kind: 'select',
        required: true,
        options: keywordLanguages,
        optionSet: 'keywordLanguages',
      },
      { name: 'priority', kind: 'checkbox' },
    ],
    title: ['keyword'],
    detail: ['language'],
  },
  {
    slug: 'experiences',
    key: 'experiences',
    fields: [
      { name: 'title', kind: 'text', required: true },
      { name: 'employer', kind: 'text', required: true },
      { name: 'location', kind: 'text' },
      { name: 'startMonth', kind: 'month' },
      { name: 'endMonth', kind: 'month' },
      { name: 'current', kind: 'checkbox' },
      { name: 'description', kind: 'textarea' },
    ],
    title: ['title', 'employer'],
    detail: ['startMonth', 'endMonth'],
  },
  {
    slug: 'facts',
    key: 'facts',
    fields: [
      { name: 'text', kind: 'textarea', required: true },
      { name: 'experienceId', kind: 'select', experienceOptions: true },
    ],
    title: ['text'],
  },
  {
    slug: 'skills',
    key: 'skills',
    fields: [
      { name: 'name', kind: 'text', required: true },
      { name: 'level', kind: 'select', options: skillLevels, optionSet: 'skillLevels' },
      { name: 'years', kind: 'number', min: 0, max: 60, step: 0.5 },
    ],
    title: ['name'],
    detail: ['level', 'years'],
  },
  {
    slug: 'languages',
    key: 'languages',
    fields: [
      {
        name: 'language',
        kind: 'select',
        required: true,
        options: spokenLanguages,
        optionSet: 'languages',
      },
      { name: 'overall', kind: 'select', required: true, options: cefr, rawOptions: true },
      { name: 'understanding', kind: 'select', options: cefr, rawOptions: true },
      { name: 'speaking', kind: 'select', options: cefr, rawOptions: true },
      { name: 'writing', kind: 'select', options: cefr, rawOptions: true },
    ],
    title: ['language'],
    detail: ['overall'],
  },
  {
    slug: 'education',
    key: 'education',
    fields: [
      { name: 'degree', kind: 'text', required: true },
      { name: 'institution', kind: 'text', required: true },
      { name: 'year', kind: 'number', min: 1950, max: 2100, step: 1 },
    ],
    title: ['degree'],
    detail: ['institution', 'year'],
  },
  {
    slug: 'certifications',
    key: 'certifications',
    fields: [
      { name: 'name', kind: 'text', required: true },
      { name: 'issuer', kind: 'text' },
      { name: 'year', kind: 'number', min: 1950, max: 2100, step: 1 },
    ],
    title: ['name'],
    detail: ['issuer', 'year'],
  },
  {
    slug: 'sectors',
    key: 'sectors',
    fields: [
      { name: 'sector', kind: 'text', required: true },
      {
        name: 'kind',
        kind: 'select',
        required: true,
        options: sectorKinds,
        optionSet: 'sectorKinds',
      },
    ],
    title: ['sector'],
    detail: ['kind'],
  },
  {
    slug: 'eliminations',
    key: 'eliminations',
    fields: [
      {
        name: 'kind',
        kind: 'select',
        required: true,
        options: eliminationKinds,
        optionSet: 'eliminationKinds',
      },
      { name: 'value', kind: 'text', required: true },
    ],
    title: ['value'],
    detail: ['kind'],
  },
  {
    slug: 'title-filters',
    key: 'titleFilters',
    fields: [
      {
        name: 'list',
        kind: 'select',
        required: true,
        options: titleFilterLists,
        optionSet: 'titleFilterLists',
      },
      { name: 'expression', kind: 'text', required: true },
    ],
    title: ['expression'],
    detail: ['list'],
  },
  {
    slug: 'excluded-companies',
    key: 'excludedCompanies',
    fields: [
      { name: 'name', kind: 'text', required: true },
      { name: 'reason', kind: 'text' },
    ],
    title: ['name'],
    detail: ['reason'],
  },
];

export const practicalOptions = { contractTypes, workRegimes, remotePreferences, transportModes };
