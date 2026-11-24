import { fold } from './text';

// Where an offer is (phase 3 plan, section 5; ADR 0017; docs/SOURCES.md, section 1.7). Each
// source writes places its own way ("Gent, Flemish Region, Belgium", "1000 Bruxelles",
// "Bruxelles (1000)"): the place is read from the names of the localities (French, Dutch, German
// and English), then from a postal code. Country and region names locate nothing, a name carried
// by two places far apart is not guessed, a foreign country is abroad. An unknown place is kept.

/** A locality of the gazetteer (the `locality` table, loaded from GeoNames). */
export interface GazetteerEntry {
  name: string;
  names: readonly string[];
  postalCodes: readonly string[];
  latitude: number;
  longitude: number;
}

export interface GeoSettings {
  /** Road distance from the straight line (1.25 in Belgium). */
  roadFactor: number;
  /** A name carried by two places further apart than this is not guessed. */
  ambiguityKm: number;
  /** Four figures in this range are years, not postal codes. */
  yearsFrom: number;
  yearsTo: number;
}

export type Place =
  | {
      status: 'found';
      name: string;
      postalCode: string | null;
      latitude: number;
      longitude: number;
    }
  | { status: 'unknown' }
  | { status: 'abroad' };
export type PlaceStatus = Place['status'];

/** What an offer announces: fully remote, or partly (hybrid). */
export type Remote = 'full' | 'hybrid';

const UNKNOWN: Place = { status: 'unknown' };
const ABROAD: Place = { status: 'abroad' };

/** Letters and figures only, single spaces: "Louvain-la-Neuve" is "louvain la neuve". */
const key = (value: string) =>
  fold(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Straight-line distance in kilometres. */
export function straightKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Road distance in whole kilometres: the straight line × the road factor (ADR 0017). */
export function roadKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
  factor: number,
): number {
  return Math.round(straightKm(a, b) * factor);
}

/** The country itself locates nothing. */
const HOME = new Set(['belgium', 'belgique', 'belgie', 'belgien', 'be', 'benelux']);
/** The province or the country: never placed in either Belgian Luxembourg or abroad alone. */
const LUXEMBOURG = new Set(['luxembourg', 'luxemburg', 'grand duche de luxembourg', 'lu']);
const FOREIGN = new Set([
  'france',
  'frankrijk',
  'frankreich',
  'fr',
  'nederland',
  'netherlands',
  'the netherlands',
  'pays bas',
  'holland',
  'nl',
  'deutschland',
  'germany',
  'allemagne',
  'duitsland',
  'de',
  'united kingdom',
  'royaume uni',
  'verenigd koninkrijk',
  'uk',
  'gb',
  'england',
  'ireland',
  'irlande',
  'spain',
  'espagne',
  'spanje',
  'italy',
  'italie',
  'italia',
  'switzerland',
  'suisse',
  'zwitserland',
  'schweiz',
  'austria',
  'autriche',
  'poland',
  'pologne',
  'portugal',
  'usa',
  'united states',
  'etats unis',
]);
/** Regions, provinces and the like: too wide to place an offer (« Flemish Region »). */
const REGION_WORDS = new Set([
  'province',
  'provincie',
  'provinz',
  'region',
  'regio',
  'gewest',
  'arrondissement',
  'district',
  'canton',
  'kanton',
]);
const REGIONS = new Set([
  'vlaanderen',
  'flanders',
  'flandre',
  'flandres',
  'wallonie',
  'wallonia',
  'wallonien',
  'hainaut',
  'henegouwen',
  'limburg',
  'limbourg',
  'brabant',
  'brabant wallon',
  'waals brabant',
  'walloon brabant',
  'vlaams brabant',
  'brabant flamand',
  'flemish brabant',
  'oost vlaanderen',
  'east flanders',
  'flandre orientale',
  'west vlaanderen',
  'west flanders',
  'flandre occidentale',
  'europe',
  'emea',
]);
/** The Brussels-Capital Region is the city and its communes: placed in Brussels. */
const BRUSSELS_REGION = new Set([
  'region de bruxelles capitale',
  'bruxelles capitale',
  'brussels capital region',
  'brussels capital',
  'brussels hoofdstedelijk gewest',
  'brussels gewest',
  'brussels region',
  'region bruxelloise',
]);
/** A part of a place or a title that only says how one works: « (Remote) », « - Hybride ». */
const MODE_PART =
  /^(?:full |fully |100 )?(remote|teletravail|tele travail|thuiswerk|telewerk|hybride|hybrid|home office)(?: work| working| possible| partiel| first| only)?$/;
/** Where a place is cut into parts: commas, brackets, slashes, spaced dashes. */
const PARTS = /[,;()|/[\]]|\s[-–—•+]\s/u;

/** The gazetteer: localities by every name they carry and by postal code. */
export class Gazetteer {
  private readonly byName = new Map<string, GazetteerEntry[]>();
  private readonly byCode = new Map<string, GazetteerEntry[]>();
  private readonly mainName = new Map<GazetteerEntry, string>();

  constructor(
    entries: readonly GazetteerEntry[],
    private readonly settings: GeoSettings,
  ) {
    const push = (map: Map<string, GazetteerEntry[]>, value: string, entry: GazetteerEntry) => {
      const list = map.get(value);
      if (!list) map.set(value, [entry]);
      else if (!list.includes(entry)) list.push(entry);
    };
    for (const entry of entries) {
      this.mainName.set(entry, key(entry.name));
      for (const name of [entry.name, ...entry.names]) {
        const folded = key(name);
        if (folded !== '') push(this.byName, folded, entry);
      }
      for (const code of entry.postalCodes) push(this.byCode, code, entry);
    }
  }

  get size(): number {
    return this.byName.size;
  }

  private isPostalCode(token: string): boolean {
    if (!/^\d{4}$/.test(token)) return false;
    const value = Number(token);
    if (value >= this.settings.yearsFrom && value <= this.settings.yearsTo) return false;
    return this.byCode.has(token);
  }

  /**
   * The localities a name designates: those it is the official name of, else those it is
   * another name of (« Mechelen » is the city, not the villages that locals also call so).
   */
  private named(name: string): GazetteerEntry[] | undefined {
    const all = this.byName.get(name);
    if (!all) return undefined;
    const official = all.filter((entry) => this.mainName.get(entry) === name);
    return official.length > 0 ? official : all;
  }

  /** The localities of the longest run of words that names one (three letters at least). */
  private longestName(words: readonly string[]): GazetteerEntry[] | undefined {
    for (let size = words.length; size >= 1; size -= 1) {
      for (let start = 0; start + size <= words.length; start += 1) {
        const name = words.slice(start, start + size).join(' ');
        if (name.length < 3) continue;
        const found = this.named(name);
        if (found) return found;
      }
    }
    return undefined;
  }

  /** Several places of the same name further apart than the threshold: not guessed. */
  private spread(entries: readonly GazetteerEntry[]): boolean {
    return entries.some((a) => entries.some((b) => straightKm(a, b) > this.settings.ambiguityKm));
  }

  /** The main locality of a postal code: several codes, then other names (Wavre before Limal). */
  private static main(entries: readonly GazetteerEntry[]): GazetteerEntry {
    return [...entries].sort(
      (a, b) => b.postalCodes.length - a.postalCodes.length || b.names.length - a.names.length,
    )[0]!;
  }

  /** Reads a place as a source writes it. */
  locate(text: string | null | undefined): Place {
    if (!text) return UNKNOWN;
    let foreign = false;
    let luxembourg = false;
    let named: GazetteerEntry[] | undefined;
    let postal: string | null = null;
    for (const raw of fold(text).split(PARTS)) {
      const part = key(raw);
      if (part === '' || part === '?' || MODE_PART.test(part) || HOME.has(part)) continue;
      if (LUXEMBOURG.has(part)) {
        luxembourg = true;
        continue;
      }
      if (FOREIGN.has(part)) {
        foreign = true;
        continue;
      }
      if (BRUSSELS_REGION.has(part)) {
        named ??= this.named('bruxelles');
        continue;
      }
      const tokens = part.split(' ');
      if (REGIONS.has(part) || tokens.some((token) => REGION_WORDS.has(token))) continue;
      postal ??= tokens.find((token) => this.isPostalCode(token)) ?? null;
      if (!named) {
        const words = tokens.filter((token) => !/^\d+$/.test(token));
        named = this.named(words.join(' ')) ?? this.longestName(words);
      }
    }

    let entry: GazetteerEntry | undefined;
    if (named) {
      const code = postal;
      const withCode = code ? named.filter((item) => item.postalCodes.includes(code)) : [];
      const candidates = withCode.length > 0 ? withCode : named;
      if (!this.spread(candidates)) entry = Gazetteer.main(candidates);
    }
    if (!entry && postal) entry = Gazetteer.main(this.byCode.get(postal)!);
    if (entry) {
      // An explicit foreign country wins (« Lille, France »); Luxembourg may be the province.
      if (foreign) return ABROAD;
      return {
        status: 'found',
        name: entry.name,
        postalCode: postal && entry.postalCodes.includes(postal) ? postal : entry.postalCodes[0]!,
        latitude: entry.latitude,
        longitude: entry.longitude,
      };
    }
    return foreign || luxembourg ? ABROAD : UNKNOWN;
  }

  /** The base city of the profile: its name and postal code, either one may be missing. */
  locateBase(city: string | null, postalCode: string | null): Place {
    return this.locate([city, postalCode].filter(Boolean).join(' '));
  }
}

/** A description that announces full remote work. */
const FULLY =
  /\b(?:full|fully|totalement|entierement|completement|volledig|uniquement|100) ?%? ?(?:en )?(?:remote|teletravail|thuiswerk|telewerk|a distance)\b|\b(?:remote|teletravail|thuiswerk) (?:only|uniquement)\b/;
/** Words of a description that only speak of working from home (never « remote control »). */
const AT_HOME =
  /\b(?:teletravail|tele travail|thuiswerk|thuiswerken|telewerk|telewerken|home office|work from home|working from home|travail a distance|remote work|remote working|work remotely)\b/g;
const NEGATION = /\b(?:pas de|pas|no|non|geen|zonder|without|sans)\s(?:\w+\s){0,2}$/;

/** The work mode a place or a title states in a part of its own. */
function modeOfParts(text: string | null | undefined): Remote | null {
  if (!text) return null;
  let found: Remote | null = null;
  for (const raw of fold(text).split(PARTS)) {
    const match = MODE_PART.exec(key(raw));
    if (!match) continue;
    if (!match[1]!.startsWith('hybri')) return 'full';
    found = 'hybrid';
  }
  return found;
}

/** What a description says of remote work, negations aside (« pas de télétravail »). */
function modeOfDescription(text: string | null | undefined): Remote | null {
  if (!text) return null;
  const folded = fold(text)
    .replace(/[^\p{L}\p{N}%\s]+/gu, ' ')
    .replace(/\s+/g, ' ');
  if (FULLY.test(folded)) return 'full';
  for (const match of folded.matchAll(AT_HOME)) {
    const before = folded.slice(Math.max(0, match.index - 25), match.index);
    if (!NEGATION.test(before)) return 'hybrid';
  }
  return null;
}

/**
 * Remote work announced by an offer (ADR 0017): « Remote » as its place or as a part of its
 * title means fully remote, « hybride » partly; in the description, only an explicit
 * « 100 % télétravail » means fully remote, and working from home mentioned otherwise is hybrid.
 */
export function remoteOf(offer: {
  location?: string | null;
  title?: string | null;
  description?: string | null;
}): Remote | null {
  const found = [
    modeOfParts(offer.location),
    modeOfParts(offer.title),
    modeOfDescription(offer.description),
  ];
  if (found.includes('full')) return 'full';
  return found.includes('hybrid') ? 'hybrid' : null;
}
