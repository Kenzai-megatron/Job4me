import { startsAWord } from './prefilter';
import type { ContractKind } from './screen';
import { languagesIn } from './screen';
import { fold } from './text';

// The scoring without AI (phase 3 plan, section 7; ADR 0018): free and deterministic, the
// default while Claude stays off (decision D5). A score on 100 from the profile: the title near
// a target job or a keyword, the profile's skills cited, the languages asked against the
// profile's levels, the distance, the contract and working time, the freshness; an excluded
// sector or a rejected title word lowers it. Always explained by its factors (the interface
// words them), always at low confidence: it never triggers an automatic sending (phase 5).

/** Changes with the rules below: every score is computed again. */
export const RULES_VERSION = 'rules-1';

export interface RuleWeights {
  title: number;
  skills: number;
  languages: number;
  distance: number;
  contract: number;
  freshness: number;
}

export interface RulePenalties {
  /** An excluded sector cited by the offer. */
  excludedSector: number;
  /** A « reject » expression of the title filter in the title (a source without the filter). */
  rejectedTitle: number;
}

export interface ScoreProfile {
  targetJobs: readonly string[];
  keywords: ReadonlyArray<{ keyword: string; priority: boolean }>;
  skills: readonly string[];
  /** CEFR level by language code: { nl: 'B1' }. */
  languages: Readonly<Record<string, string>>;
  contracts: readonly ContractKind[];
  regimes: ReadonlyArray<'full_time' | 'part_time'>;
  radiusKm: number;
  acceptsRemote: boolean;
  excludedSectors: readonly string[];
  rejectExpressions: readonly string[];
  /** YYYY-MM-DD, in Brussels. */
  today: string;
}

export interface ScoreOffer {
  title: string;
  description: string;
  details: string | null;
  placeStatus: 'found' | 'unknown' | 'abroad' | null;
  distanceKm: number | null;
  remote: 'full' | 'hybrid' | null;
  contracts: readonly ContractKind[];
  /** Languages required in a field of the source. */
  languages: readonly string[];
  /** The latest publication date, else the first sighting (YYYY-MM-DD). */
  postedOn: string;
}

/** What made the score, as data: the interface words it, the reference set measures it. */
export type ScoreFactor =
  | {
      kind: 'title';
      strength: 'target' | 'priority' | 'keyword' | 'partial' | 'none';
      match: string | null;
    }
  | { kind: 'skills'; matched: string[] }
  | { kind: 'language'; code: string; level: string | null }
  | {
      kind: 'distance';
      status: 'found' | 'unknown' | 'abroad' | null;
      km: number | null;
      remote: 'full' | 'hybrid' | null;
    }
  | { kind: 'contract'; contracts: ContractKind[]; wanted: boolean | null }
  | { kind: 'regime'; regime: 'full_time' | 'part_time'; wanted: boolean }
  | { kind: 'freshness'; days: number }
  | { kind: 'sector'; sector: string }
  | { kind: 'rejected'; expression: string };

export interface RuleScore {
  score: number;
  factors: ScoreFactor[];
}

const STOP_WORDS = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'l',
  'd',
  'en',
  'et',
  'a',
  'au',
  'aux',
  'pour',
  'van',
  'het',
  'een',
  'the',
  'of',
  'and',
  'or',
  'ou',
  'h',
  'f',
  'm',
  'v',
  'x',
]);

const tokens = (text: string) =>
  fold(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));

/** A word of the title that answers a word asked: the same, or a stem of five letters or more. */
const answers = (word: string, asked: string) =>
  word === asked || (asked.length >= 5 && word.startsWith(asked));

/** The share of the asked words found in the title's words. */
function coverage(title: readonly string[], asked: readonly string[]): number {
  if (asked.length === 0) return 0;
  const found = asked.filter((word) => title.some((candidate) => answers(candidate, word)));
  return found.length / asked.length;
}

/** A phrase found in a text at word boundaries, accents and case aside. */
function cites(text: string, phrase: string): boolean {
  const needle = fold(phrase)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (needle.length < 2) return false;
  const haystack = ` ${fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return haystack.includes(` ${needle} `);
}

function titleFactor(offer: ScoreOffer, profile: ScoreProfile): [number, ScoreFactor] {
  const title = tokens(offer.title);
  const candidates = [
    ...profile.targetJobs.map((text) => ({ text, value: 1, strength: 'target' as const })),
    ...profile.keywords.map(({ keyword, priority }) => ({
      text: keyword,
      value: priority ? 0.9 : 0.75,
      strength: priority ? ('priority' as const) : ('keyword' as const),
    })),
  ];
  let best: [number, ScoreFactor] = [0, { kind: 'title', strength: 'none', match: null }];
  for (const candidate of candidates) {
    const share = coverage(title, tokens(candidate.text));
    const value = share === 1 ? candidate.value : share >= 0.5 ? 0.6 * share : 0;
    if (value > best[0]) {
      best = [
        value,
        {
          kind: 'title',
          strength: share === 1 ? candidate.strength : 'partial',
          match: candidate.text,
        },
      ];
    }
  }
  return best;
}

const LEVELS: Record<string, number> = { C2: 1, C1: 1, B2: 0.9, B1: 0.6, A2: 0.3, A1: 0.2 };

function regimeOf(details: string | null): 'full_time' | 'part_time' | null {
  if (!details) return null;
  const folded = fold(details);
  if (/\b(?:temps partiel|mi temps|part time|deeltijds)\b/.test(folded.replace(/-/g, ' '))) {
    return 'part_time';
  }
  if (/\b(?:temps plein|full time|voltijds)\b/.test(folded.replace(/-/g, ' '))) return 'full_time';
  return null;
}

const DAY_MS = 86_400_000;

/** The score of an offer kept by the filter, with what made it. */
export function scoreOffer(
  offer: ScoreOffer,
  profile: ScoreProfile,
  weights: RuleWeights,
  penalties: RulePenalties,
): RuleScore {
  const text = `${offer.title} ${offer.description}`;
  const factors: ScoreFactor[] = [];

  const [titleValue, titleWhy] = titleFactor(offer, profile);
  factors.push(titleWhy);

  // The profile's skills cited by the offer: three make the whole part. Without a description,
  // nothing can be cited: neither good nor bad.
  const matched = profile.skills.filter((skill) => cites(text, skill));
  const skills =
    profile.skills.length === 0 || offer.description.trim() === ''
      ? 0.5
      : Math.min(1, matched.length / 3);
  if (matched.length > 0) factors.push({ kind: 'skills', matched: matched.slice(0, 5) });

  // Languages asked (a field of the source, or named in the text) against the profile's levels:
  // the weakest one counts. None asked: almost full.
  const asked = [...new Set([...offer.languages, ...languagesIn(text)])];
  let languages = asked.length === 0 ? 0.8 : 1;
  for (const code of asked) {
    const level = profile.languages[code] ?? null;
    languages = Math.min(languages, level ? (LEVELS[level] ?? 0.5) : code === 'fr' ? 0.8 : 0);
    if (code !== 'fr' || !level) factors.push({ kind: 'language', code, level });
  }

  // Distance from the base city; full remote work accepted answers it.
  let distance: number;
  if (offer.remote === 'full' && profile.acceptsRemote) distance = 1;
  else if (offer.placeStatus === 'abroad') distance = 0;
  else if (offer.placeStatus !== 'found' || offer.distanceKm === null) distance = 0.6;
  else if (offer.distanceKm <= profile.radiusKm / 4) distance = 1;
  else if (offer.distanceKm <= profile.radiusKm) {
    const share = (offer.distanceKm - profile.radiusKm / 4) / (profile.radiusKm * 0.75);
    distance = 1 - 0.5 * share;
  } else distance = offer.remote && profile.acceptsRemote ? 0.6 : 0.2;
  factors.push({
    kind: 'distance',
    status: offer.placeStatus,
    km: offer.distanceKm,
    remote: offer.remote,
  });

  // Contract and working time, when the source gives them.
  let contract = 0.6;
  if (offer.contracts.length > 0) {
    const wanted =
      profile.contracts.length === 0
        ? null
        : offer.contracts.some((value) => profile.contracts.includes(value));
    contract = wanted === false ? 0.3 : 1;
    factors.push({ kind: 'contract', contracts: [...offer.contracts], wanted });
  }
  const regime = regimeOf(offer.details);
  if (regime && profile.regimes.length > 0) {
    const wanted = profile.regimes.includes(regime);
    if (!wanted) contract *= 0.5;
    factors.push({ kind: 'regime', regime, wanted });
  }

  // Freshness: an ad of the last days is worth more than one of last month.
  const days = Math.max(
    0,
    Math.round((Date.parse(profile.today) - Date.parse(offer.postedOn)) / DAY_MS),
  );
  const freshness = days <= 3 ? 1 : days <= 14 ? 0.8 : days <= 30 ? 0.5 : 0.2;
  factors.push({ kind: 'freshness', days });

  // The practical criteria only count as much as the offer is on topic: a fresh and near offer
  // whose title and skills match nothing stays off topic.
  const relevance = Math.max(titleValue, 0.7 * Math.min(1, matched.length / 3));
  const practical =
    weights.languages * languages +
    weights.distance * distance +
    weights.contract * contract +
    weights.freshness * freshness;
  let score =
    weights.title * titleValue + weights.skills * skills + practical * (0.25 + 0.75 * relevance);

  const sector = profile.excludedSectors.find((name) => cites(text, name));
  if (sector) {
    score -= penalties.excludedSector;
    factors.push({ kind: 'sector', sector });
  }
  const title = fold(offer.title);
  const rejected = profile.rejectExpressions.find((expression) => {
    const needle = fold(expression);
    return needle !== '' && startsAWord(title, needle);
  });
  if (rejected) {
    score -= penalties.rejectedTitle;
    factors.push({ kind: 'rejected', expression: rejected });
  }
  return { score: Math.max(0, Math.min(100, Math.round(score))), factors };
}
