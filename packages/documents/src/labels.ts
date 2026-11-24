import type { DocumentLanguage } from '@job4me/contracts';

// The words a document writes around the facts of the profile, in the document's language: level
// names, language names, « today ». Never a fact: they only say how a fact is measured.

interface Labels {
  skillLevels: Record<string, string>;
  languages: Record<string, string>;
  today: string;
  years: (count: number) => string;
}

const FR: Labels = {
  skillLevels: {
    beginner: 'débutant',
    intermediate: 'intermédiaire',
    advanced: 'avancé',
    expert: 'expert',
  },
  languages: {
    fr: 'Français',
    nl: 'Néerlandais',
    en: 'Anglais',
    de: 'Allemand',
    es: 'Espagnol',
    it: 'Italien',
    pt: 'Portugais',
    ar: 'Arabe',
    tr: 'Turc',
    pl: 'Polonais',
    ru: 'Russe',
  },
  today: 'aujourd’hui',
  years: (count) => `${String(count).replace('.', ',')} ${count < 2 ? 'an' : 'ans'}`,
};

const NL: Labels = {
  skillLevels: {
    beginner: 'beginner',
    intermediate: 'gevorderd',
    advanced: 'ervaren',
    expert: 'expert',
  },
  languages: {
    fr: 'Frans',
    nl: 'Nederlands',
    en: 'Engels',
    de: 'Duits',
    es: 'Spaans',
    it: 'Italiaans',
    pt: 'Portugees',
    ar: 'Arabisch',
    tr: 'Turks',
    pl: 'Pools',
    ru: 'Russisch',
  },
  today: 'heden',
  years: (count) => `${String(count).replace('.', ',')} jaar`,
};

const EN: Labels = {
  skillLevels: {
    beginner: 'beginner',
    intermediate: 'intermediate',
    advanced: 'advanced',
    expert: 'expert',
  },
  languages: {
    fr: 'French',
    nl: 'Dutch',
    en: 'English',
    de: 'German',
    es: 'Spanish',
    it: 'Italian',
    pt: 'Portuguese',
    ar: 'Arabic',
    tr: 'Turkish',
    pl: 'Polish',
    ru: 'Russian',
  },
  today: 'present',
  years: (count) => `${count} ${count === 1 ? 'year' : 'years'}`,
};

export function labelsOf(language: DocumentLanguage): Labels {
  return language === 'nl' ? NL : language === 'en' ? EN : FR;
}
