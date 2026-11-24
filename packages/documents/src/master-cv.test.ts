import { describe, expect, it } from 'vitest';
import { buildMasterCv, type CvProfile, cvElements, EMPTY_LAYOUT } from './master-cv';

// The master CV built from a fictitious profile (phase 4 plan, section 4): every line a fact of
// the profile, with its source; Mehdi's layout orders and hides.

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const profile: CvProfile = {
  targetJob: { id: id(1), title: 'Comptable' },
  experiences: [
    {
      id: id(10),
      title: 'Aide-comptable',
      employer: 'Démo Fiduciaire',
      location: 'Bruxelles',
      startMonth: '2019-01',
      endMonth: '2021-06',
      current: false,
      description: null,
    },
    {
      id: id(11),
      title: 'Comptable',
      employer: 'Exemple SA',
      location: null,
      startMonth: '2021-09',
      endMonth: null,
      current: true,
      description: 'Comptabilité générale d’une PME de 40 personnes.',
    },
  ],
  facts: [
    { id: id(20), text: 'Clôtures mensuelles en 5 jours au lieu de 8', experienceId: id(11) },
    { id: id(21), text: 'Migration vers Winbooks', experienceId: id(11) },
    { id: id(22), text: 'Encodage de 3 000 factures par an', experienceId: id(10) },
    { id: id(23), text: 'Bénévole trésorier d’un club sportif', experienceId: null },
  ],
  skills: [
    { id: id(30), name: 'Excel', level: 'advanced', years: 6 },
    { id: id(31), name: 'Winbooks', level: 'expert', years: 4 },
    { id: id(32), name: 'SAP', level: null, years: null },
  ],
  languages: [
    { id: id(40), language: 'nl', overall: 'B1' },
    { id: id(41), language: 'fr', overall: 'C2' },
  ],
  educations: [
    { id: id(50), degree: 'Bachelier en comptabilité', institution: 'HE Démo', year: 2018 },
  ],
  certifications: [],
};

const build = (layout = EMPTY_LAYOUT, language: 'fr' | 'nl' | 'en' = 'fr') =>
  buildMasterCv(profile, layout, { language, template: 'classic' });

describe('the master CV', () => {
  it('takes every line from the profile, with its source, the current job first', () => {
    const cv = build();
    expect(cv.title).toMatchObject({
      text: 'Comptable',
      sources: [{ kind: 'target_job', id: id(1) }],
    });
    const experience = cv.sections.find((section) => section.kind === 'experience')!;
    expect(experience.entries.map((entry) => entry.heading.text)).toEqual([
      'Comptable — Exemple SA',
      'Aide-comptable — Démo Fiduciaire',
    ]);
    expect(experience.entries[0]!.meta).toBe('09/2021 – aujourd’hui');
    expect(experience.entries[1]!.meta).toBe('01/2019 – 06/2021 · Bruxelles');
    expect(experience.entries[0]!.lines.map((line) => line.text)).toEqual([
      'Comptabilité générale d’une PME de 40 personnes.',
      'Clôtures mensuelles en 5 jours au lieu de 8',
      'Migration vers Winbooks',
    ]);
    for (const section of cv.sections) {
      for (const entry of section.entries) {
        for (const line of [entry.heading, ...entry.lines]) {
          if (line.key === 'achievements') continue;
          expect(line.origin).toBe('profile');
          expect(line.sources.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('puts an achievement without its experience apart, and the levels in words', () => {
    const cv = build();
    const achievements = cv.sections.find((section) => section.kind === 'achievements')!;
    expect(achievements.entries[0]!.lines.map((line) => line.text)).toEqual([
      'Bénévole trésorier d’un club sportif',
    ]);
    const skills = cv.sections.find((section) => section.kind === 'skills')!;
    expect(skills.entries.map((entry) => [entry.heading.text, entry.meta])).toEqual([
      ['Winbooks', 'expert, 4 ans'],
      ['Excel', 'avancé, 6 ans'],
      ['SAP', null],
    ]);
    const languages = cv.sections.find((section) => section.kind === 'languages')!;
    expect(languages.entries.map((entry) => [entry.heading.text, entry.meta])).toEqual([
      ['Français', 'C2'],
      ['Néerlandais', 'B1'],
    ]);
  });

  it('follows Mehdi’s order and hides what he leaves out, with his own summary', () => {
    const layout = {
      order: [`experience:${id(10)}`, `fact:${id(21)}`, `skill:${id(32)}`],
      hidden: [`description:${id(11)}`, `skill:${id(30)}`, `fact:${id(23)}`],
      summary: '  Comptable rigoureux, à l’aise avec les clôtures.  ',
    };
    const cv = build(layout);
    const experience = cv.sections.find((section) => section.kind === 'experience')!;
    expect(experience.entries.map((entry) => entry.heading.text)).toEqual([
      'Aide-comptable — Démo Fiduciaire',
      'Comptable — Exemple SA',
    ]);
    expect(experience.entries[1]!.lines.map((line) => line.text)).toEqual([
      'Migration vers Winbooks',
      'Clôtures mensuelles en 5 jours au lieu de 8',
    ]);
    const skills = cv.sections.find((section) => section.kind === 'skills')!;
    expect(skills.entries.map((entry) => entry.heading.text)).toEqual(['SAP', 'Winbooks']);
    expect(cv.sections.some((section) => section.kind === 'achievements')).toBe(false);
    expect(cv.summary).toEqual({
      key: 'summary',
      text: 'Comptable rigoureux, à l’aise avec les clôtures.',
      sources: [],
      origin: 'manual',
      check: null,
    });
  });

  it('hides the achievements of a hidden experience', () => {
    const cv = build({ ...EMPTY_LAYOUT, hidden: [`experience:${id(11)}`] });
    const texts = cv.sections.flatMap((section) =>
      section.entries.flatMap((entry) => entry.lines.map((line) => line.text)),
    );
    expect(texts).not.toContain('Migration vers Winbooks');
    expect(texts).toContain('Encodage de 3 000 factures par an');
  });

  it('writes the words around the facts in the document’s language', () => {
    const cv = build(EMPTY_LAYOUT, 'nl');
    const experience = cv.sections.find((section) => section.kind === 'experience')!;
    expect(experience.entries[0]!.meta).toBe('09/2021 – heden');
    const languages = cv.sections.find((section) => section.kind === 'languages')!;
    expect(languages.entries.map((entry) => entry.heading.text)).toEqual(['Frans', 'Nederlands']);
  });

  it('lists every element for the editor, hidden ones included', () => {
    const elements = cvElements(profile, { ...EMPTY_LAYOUT, hidden: [`skill:${id(30)}`] });
    expect(elements.find((element) => element.key === `skill:${id(30)}`)).toMatchObject({
      section: 'skills',
      hidden: true,
      label: 'Excel',
    });
    expect(elements.find((element) => element.key === `fact:${id(21)}`)).toMatchObject({
      section: 'experience',
      parent: `experience:${id(11)}`,
    });
    expect(elements).toHaveLength(2 + 1 + 4 + 3 + 2 + 1);
  });
});
