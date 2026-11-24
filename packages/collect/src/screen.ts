import type { ExclusionReason } from '@job4me/contracts';
import { employerWords } from './dedup';
import { fold } from './text';

// The deterministic filter (phase 3 plan, section 6; docs/SOURCES.md, section 1.5): free and
// without AI, large at inclusion, sharp at rejection. Only certain criteria set an offer aside:
// an employer the profile excludes, an ad older than the limit, a place abroad or beyond the
// radius (an unknown place is kept, remote work accepted too), and a language or a contract the
// source gives as a field. What a free text says (« néerlandais courant ») is left to the
// scoring, which can weigh it. An offer added by hand is never set aside: it was meant.

/** The contracts of the profile (packages/contracts, profile). */
export type ContractKind =
  'permanent' | 'fixed_term' | 'interim' | 'freelance' | 'internship' | 'student_job';

const CONTRACT_WORDS: Array<[RegExp, ContractKind]> = [
  [/\b(?:indetermin\w*|permanent|cdi|vast\w*|onbepaalde)\b/, 'permanent'],
  // A word that starts with « determin », never the end of « indéterminée ».
  [/\b(?:determin\w*|cdd|contract|tijdelijk\w*|bepaalde|remplacement|vervanging)\b/, 'fixed_term'],
  [/\b(?:interim\w*|uitzend\w*|temporary)\b/, 'interim'],
  [/\b(?:independant\w*|freelance\w*|zelfstandig\w*|self employed)\b/, 'freelance'],
  [/\b(?:stage|stagiair\w*|internship|apprentissage|alternance|duaal|duale)\b/, 'internship'],
  [/\b(?:etudiant\w*|student\w*|jobiste)\b/, 'student_job'],
];

/**
 * The contracts a source's own label names: « Durée indéterminée » is permanent,
 * « Intérimaire avec option sur durée indéterminée » interim and permanent. Unknown: none.
 */
export function contractsOf(label: string | null | undefined): ContractKind[] {
  if (!label) return [];
  const folded = fold(label).replace(/[^\p{L}\p{N}]+/gu, ' ');
  const found = new Set<ContractKind>();
  for (const [pattern, kind] of CONTRACT_WORDS) {
    if (pattern.test(folded)) found.add(kind);
  }
  return [...found];
}

/** Languages by any of their names: « Néerlandais », « Nederlands » and « Dutch » are nl. */
const LANGUAGES: Record<string, string> = {
  francais: 'fr',
  frans: 'fr',
  french: 'fr',
  franzosisch: 'fr',
  neerlandais: 'nl',
  nederlands: 'nl',
  flamand: 'nl',
  vlaams: 'nl',
  dutch: 'nl',
  niederlandisch: 'nl',
  anglais: 'en',
  engels: 'en',
  english: 'en',
  englisch: 'en',
  allemand: 'de',
  duits: 'de',
  german: 'de',
  deutsch: 'de',
  espagnol: 'es',
  spaans: 'es',
  spanish: 'es',
  italien: 'it',
  italiaans: 'it',
  italian: 'it',
  portugais: 'pt',
  portugees: 'pt',
  portuguese: 'pt',
  arabe: 'ar',
  arabisch: 'ar',
  arabic: 'ar',
  turc: 'tr',
  turks: 'tr',
  turkish: 'tr',
  polonais: 'pl',
  pools: 'pl',
  polish: 'pl',
  russe: 'ru',
  russisch: 'ru',
  russian: 'ru',
};

/** The languages a text names, as codes. */
export function languagesIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const words = fold(text).split(/[^\p{L}]+/u);
  return [...new Set(words.flatMap((word) => LANGUAGES[word] ?? []))];
}

export interface ScreenProfile {
  /** Names of the excluded employers, compared by words (« Deloitte » excludes « Deloitte Digital »). */
  excludedCompanies: readonly string[];
  radiusKm: number;
  /** Remote work accepted (the profile's preference is not « on site »). */
  acceptsRemote: boolean;
  /** Contracts the profile accepts; empty: any. */
  contracts: readonly ContractKind[];
  /** Language codes the profile's elimination rules rule out. */
  excludedLanguages: readonly string[];
  maxAgeDays: number;
  /** YYYY-MM-DD, in Brussels. */
  today: string;
}

export interface ScreenOffer {
  /** Added by hand: never set aside. */
  manual: boolean;
  /** The employers its postings name. */
  companies: readonly string[];
  /** The latest publication date of its postings, when known (YYYY-MM-DD). */
  postedOn: string | null;
  placeStatus: 'found' | 'unknown' | 'abroad' | null;
  distanceKm: number | null;
  remote: 'full' | 'hybrid' | null;
  /** Contracts given as a field by its sources; empty: unknown. */
  contracts: readonly ContractKind[];
  /** Languages its sources require as a field (the Forem); empty: unknown. */
  languages: readonly string[];
}

const DAY_MS = 86_400_000;

/** Why the offer is set aside, or null when it is kept. */
export function screen(offer: ScreenOffer, profile: ScreenProfile): ExclusionReason | null {
  if (offer.manual) return null;
  // Every word of an excluded name in the employer's: « Deloitte » sets « Deloitte Digital »
  // aside, never the reverse (an offer is never lost to a narrower name).
  const excluded = profile.excludedCompanies.map(employerWords).filter((words) => words.length);
  const named = offer.companies.map(employerWords);
  if (named.some((words) => excluded.some((rule) => rule.every((word) => words.includes(word))))) {
    return 'excluded_company';
  }
  if (offer.postedOn) {
    const age = (Date.parse(profile.today) - Date.parse(offer.postedOn)) / DAY_MS;
    if (age > profile.maxAgeDays) return 'too_old';
  }
  const remoteKept = profile.acceptsRemote && offer.remote !== null;
  if (offer.placeStatus === 'abroad' && !(profile.acceptsRemote && offer.remote === 'full')) {
    return 'abroad';
  }
  if (
    offer.placeStatus === 'found' &&
    offer.distanceKm !== null &&
    offer.distanceKm > profile.radiusKm &&
    !remoteKept
  ) {
    return 'too_far';
  }
  if (offer.languages.some((language) => profile.excludedLanguages.includes(language))) {
    return 'language';
  }
  if (
    profile.contracts.length > 0 &&
    offer.contracts.length > 0 &&
    !offer.contracts.some((contract) => profile.contracts.includes(contract))
  ) {
    return 'contract';
  }
  return null;
}
