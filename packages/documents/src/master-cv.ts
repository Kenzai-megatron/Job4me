import type {
  CvContent,
  CvElement,
  CvEntry,
  CvSection,
  CvSectionKind,
  DocumentLanguage,
  DocumentLine,
  DocumentTemplate,
  LineSource,
  MasterCvLayout,
} from '@job4me/contracts';
import { cvSectionKinds } from '@job4me/contracts';
import { labelsOf } from './labels';

// The master CV of a target job (phase 4 plan, section 4; ADR 0020), built from the profile
// without AI: every line is a fact of the profile taken as is, with its source. Mehdi's layout
// orders the elements and leaves some out; what it does not name keeps the default order.

export interface CvProfile {
  targetJob: { id: string; title: string };
  experiences: ReadonlyArray<{
    id: string;
    title: string;
    employer: string;
    location: string | null;
    startMonth: string | null;
    endMonth: string | null;
    current: boolean;
    description: string | null;
  }>;
  facts: ReadonlyArray<{ id: string; text: string; experienceId: string | null }>;
  skills: ReadonlyArray<{ id: string; name: string; level: string | null; years: number | null }>;
  languages: ReadonlyArray<{ id: string; language: string; overall: string }>;
  educations: ReadonlyArray<{
    id: string;
    degree: string;
    institution: string;
    year: number | null;
  }>;
  certifications: ReadonlyArray<{
    id: string;
    name: string;
    issuer: string | null;
    year: number | null;
  }>;
}

export const EMPTY_LAYOUT: MasterCvLayout = { order: [], hidden: [], summary: null };

const SKILL_RANK: Record<string, number> = { expert: 4, advanced: 3, intermediate: 2, beginner: 1 };
const CEFR_RANK: Record<string, number> = { C2: 6, C1: 5, B2: 4, B1: 3, A2: 2, A1: 1 };

/** MM/YYYY from YYYY-MM. */
const month = (value: string) => `${value.slice(5, 7)}/${value.slice(0, 4)}`;

function line(key: string, text: string, sources: LineSource[]): DocumentLine {
  return { key, text, sources, origin: 'profile', check: null };
}

interface Element extends CvElement {
  /** The default rank within its section (or its experience). */
  rank: number;
  build: () => CvEntry | DocumentLine;
}

/** Every element of the profile a CV of this language can show, in the default order. */
function elementsOf(profile: CvProfile, language: DocumentLanguage): Element[] {
  const labels = labelsOf(language);
  const elements: Element[] = [];
  const experiences = [...profile.experiences].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      (b.endMonth ?? b.startMonth ?? '').localeCompare(a.endMonth ?? a.startMonth ?? '') ||
      (b.startMonth ?? '').localeCompare(a.startMonth ?? ''),
  );
  experiences.forEach((experience, rank) => {
    const key = `experience:${experience.id}`;
    const period = experience.startMonth
      ? `${month(experience.startMonth)} – ${
          experience.current
            ? labels.today
            : experience.endMonth
              ? month(experience.endMonth)
              : month(experience.startMonth)
        }`
      : null;
    elements.push({
      key,
      section: 'experience',
      parent: null,
      label: `${experience.title} · ${experience.employer}`,
      hidden: false,
      rank,
      build: () => ({
        key,
        heading: line(key, `${experience.title} — ${experience.employer}`, [
          { kind: 'experience', id: experience.id },
        ]),
        meta: [period, experience.location].filter(Boolean).join(' · ') || null,
        lines: [],
      }),
    });
    if (experience.description) {
      const descriptionKey = `description:${experience.id}`;
      elements.push({
        key: descriptionKey,
        section: 'experience',
        parent: key,
        label: experience.description,
        hidden: false,
        rank: -1,
        build: () =>
          line(descriptionKey, experience.description ?? '', [
            { kind: 'experience', id: experience.id },
          ]),
      });
    }
  });
  const known = new Set(profile.experiences.map((experience) => experience.id));
  profile.facts.forEach((fact, rank) => {
    const factKey = `fact:${fact.id}`;
    const parent =
      fact.experienceId && known.has(fact.experienceId) ? `experience:${fact.experienceId}` : null;
    elements.push({
      key: factKey,
      section: parent ? 'experience' : 'achievements',
      parent,
      label: fact.text,
      hidden: false,
      rank,
      build: () => line(factKey, fact.text, [{ kind: 'fact', id: fact.id }]),
    });
  });
  [...profile.skills]
    .sort(
      (a, b) =>
        (SKILL_RANK[b.level ?? ''] ?? 0) - (SKILL_RANK[a.level ?? ''] ?? 0) ||
        (b.years ?? 0) - (a.years ?? 0),
    )
    .forEach((skill, rank) => {
      const key = `skill:${skill.id}`;
      const meta = [
        skill.level ? labels.skillLevels[skill.level] : null,
        skill.years !== null ? labels.years(skill.years) : null,
      ]
        .filter(Boolean)
        .join(', ');
      elements.push({
        key,
        section: 'skills',
        parent: null,
        label: skill.name,
        hidden: false,
        rank,
        build: () => ({
          key,
          heading: line(key, skill.name, [{ kind: 'skill', id: skill.id }]),
          meta: meta || null,
          lines: [],
        }),
      });
    });
  [...profile.languages]
    .sort((a, b) => (CEFR_RANK[b.overall] ?? 0) - (CEFR_RANK[a.overall] ?? 0))
    .forEach((item, rank) => {
      const key = `language:${item.id}`;
      const name = labels.languages[item.language] ?? item.language.toUpperCase();
      elements.push({
        key,
        section: 'languages',
        parent: null,
        label: name,
        hidden: false,
        rank,
        build: () => ({
          key,
          heading: line(key, name, [{ kind: 'language', id: item.id }]),
          meta: item.overall,
          lines: [],
        }),
      });
    });
  [...profile.educations]
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .forEach((education, rank) => {
      const key = `education:${education.id}`;
      elements.push({
        key,
        section: 'education',
        parent: null,
        label: education.degree,
        hidden: false,
        rank,
        build: () => ({
          key,
          heading: line(key, education.degree, [{ kind: 'education', id: education.id }]),
          meta:
            [education.institution, education.year ? String(education.year) : null]
              .filter(Boolean)
              .join(' · ') || null,
          lines: [],
        }),
      });
    });
  [...profile.certifications]
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .forEach((certification, rank) => {
      const key = `certification:${certification.id}`;
      elements.push({
        key,
        section: 'certifications',
        parent: null,
        label: certification.name,
        hidden: false,
        rank,
        build: () => ({
          key,
          heading: line(key, certification.name, [{ kind: 'certification', id: certification.id }]),
          meta:
            [certification.issuer, certification.year ? String(certification.year) : null]
              .filter(Boolean)
              .join(' · ') || null,
          lines: [],
        }),
      });
    });
  return elements;
}

/** Elements in the layout's order first, then the others in their default order. */
function ordered(elements: readonly Element[], layout: MasterCvLayout): Element[] {
  const position = new Map(layout.order.map((key, index) => [key, index]));
  return [...elements].sort((a, b) => {
    const pa = position.get(a.key);
    const pb = position.get(b.key);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return a.rank - b.rank;
  });
}

/** What the editor shows: every element, hidden ones included, in the CV's order. */
export function cvElements(
  profile: CvProfile,
  layout: MasterCvLayout,
  language: DocumentLanguage = 'fr',
): CvElement[] {
  const hidden = new Set(layout.hidden);
  return ordered(elementsOf(profile, language), layout).map((element) => ({
    key: element.key,
    section: element.section,
    parent: element.parent,
    label: element.label,
    hidden: hidden.has(element.key),
  }));
}

/** The master CV of a target job, as a document of the given language and template. */
export function buildMasterCv(
  profile: CvProfile,
  layout: MasterCvLayout,
  options: { language: DocumentLanguage; template: DocumentTemplate },
): CvContent {
  const hidden = new Set(layout.hidden);
  const elements = ordered(elementsOf(profile, options.language), layout).filter(
    (element) => !hidden.has(element.key),
  );
  const sections = new Map<CvSectionKind, CvEntry[]>();
  const entries = new Map<string, CvEntry>();
  for (const element of elements.filter((item) => item.parent === null)) {
    if (element.section === 'achievements') continue;
    const entry = element.build() as CvEntry;
    entries.set(element.key, entry);
    const list = sections.get(element.section) ?? [];
    list.push(entry);
    sections.set(element.section, list);
  }
  // Achievements under their experience (a hidden experience hides them); the others apart.
  const achievements: CvEntry = {
    key: 'achievements',
    heading: line('achievements', '', []),
    meta: null,
    lines: [],
  };
  for (const element of elements) {
    if (element.parent !== null) {
      entries.get(element.parent)?.lines.push(element.build() as DocumentLine);
    } else if (element.section === 'achievements') {
      achievements.lines.push(element.build() as DocumentLine);
    }
  }
  if (achievements.lines.length > 0) sections.set('achievements', [achievements]);
  const summary = layout.summary?.trim();
  return {
    kind: 'cv',
    language: options.language,
    template: options.template,
    title: line('title', profile.targetJob.title, [
      { kind: 'target_job', id: profile.targetJob.id },
    ]),
    // Written by Mehdi himself: his own words, never checked against the facts.
    summary: summary
      ? { key: 'summary', text: summary, sources: [], origin: 'manual', check: null }
      : null,
    sections: cvSectionKinds.flatMap((kind) => {
      const list = sections.get(kind);
      return list && list.length > 0 ? [{ kind, entries: list } satisfies CvSection] : [];
    }),
  };
}
