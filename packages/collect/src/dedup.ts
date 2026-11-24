import { createHash } from 'node:crypto';
import { type MergeReason, mergeReasons } from '@job4me/contracts';
import { fold } from './text';

// One announcement, however many sites carry it (docs/SOURCES.md, section 1.6; ADR 0016).
//
// The content key hashes the normalized title and employer, never the URL. Republications the
// key misses are merged by narrow rules, always at an identical "bare" title (normalized,
// without the employer or any figure): a common internal reference, one of the two without an
// employer, or the same employer up to a name extension, compared by words. Two named employers
// that differ are never merged without a common reference, and neither are two postings whose
// references all differ. A wrong merge hides an offer: the rules stay narrow, and every merge can
// be undone from the offer's page.

/** Bumped when the normalization changes: stored postings are identified again at start-up. */
export const DEDUP_VERSION = 1;

export interface PostingIdentity {
  /** sha1(normalized title | normalized employer), 16 hexadecimal characters. */
  key: string;
  /** Without gender marks, references, places, contract words, employer or punctuation. */
  title: string;
  /** The same without any figure; empty when nothing is left, and then no rule applies. */
  bare: string;
  /** Internal references of the title, figures only: "R0012345" and "0012345" agree. */
  refs: string[];
  /** The employer's words without legal forms; empty when unknown ("?" or a job site). */
  employer: string[];
}

/** What the merge rules compare: a posting, stored or just collected. */
export interface Comparable {
  source: string;
  url: string | null;
  identity: Pick<PostingIdentity, 'key' | 'bare' | 'refs' | 'employer'>;
}

/** Why a posting joined an announcement, strongest first (the contracts' list). */
export const MERGE_REASONS = mergeReasons;
export type { MergeReason };

/**
 * `batch`: postings of the same run of a source, where every rule applies. `history`: postings
 * already stored, where "one without an employer" never applies and "the same employer up to an
 * extension" only applies across sources (docs/SOURCES.md, section 1.6).
 */
export type MergeScope = 'batch' | 'history';

const words = (value: string): string[] =>
  fold(value)
    .replace(/€/g, ' eur ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

const phrases = (list: readonly string[]): string[][] =>
  list.map((phrase) => phrase.split(' ')).sort((a, b) => b.length - a.length);

/** Removes every occurrence of the phrases, as whole words. */
function withoutPhrases(tokens: readonly string[], list: readonly string[][]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < tokens.length;) {
    const phrase = list.find((candidate) =>
      candidate.every((word, offset) => tokens[index + offset] === word),
    );
    if (phrase) index += phrase.length;
    else kept.push(tokens[index++]!);
  }
  return kept;
}

/** Legal forms and the like, dropped from employer names ("Sander Group BV" is "Sander"). */
const LEGAL_FORMS = new Set([
  'srl',
  'sprl',
  'sa',
  'nv',
  'bv',
  'bvba',
  'cv',
  'cvba',
  'scrl',
  'sc',
  'scs',
  'snc',
  'commv',
  'asbl',
  'vzw',
  'se',
  'sas',
  'sarl',
  'gmbh',
  'ltd',
  'inc',
  'llc',
  'plc',
  'group',
  'groupe',
  'groep',
  'belgium',
  'belgique',
  'belgie',
]);

/** Job sites an aggregator writes where the employer should be: the employer is unknown. */
const JOB_SITES = new Set([
  'linkedin',
  'linkedin com',
  'indeed',
  'indeed com',
  'stepstone',
  'stepstone be',
  'jobat',
  'jobat be',
  'jobijoba',
  'jobrapido',
  'talent com',
  'glassdoor',
  'monster',
  'jooble',
  'careerjet',
  'adzuna',
  'optioncarriere',
  'ictjob',
  'ictjob be',
  'vacature com',
  'references be',
  'actiris',
  'forem',
  'le forem',
  'vdab',
]);

/** The employer's words without legal forms; none when unknown or a job site's name. */
export function employerWords(company: string): string[] {
  const all = words(company).filter((word) => !LEGAL_FORMS.has(word));
  return all.length === 0 || JOB_SITES.has(all.join(' ')) ? [] : all;
}

/** A job site's name written where the employer should be ("LinkedIn", "StepStone Belgium"). */
export function isJobSite(company: string): boolean {
  const all = words(company).filter((word) => !LEGAL_FORMS.has(word));
  return all.length > 0 && JOB_SITES.has(all.join(' '));
}

/** Gender marks, also mistyped ("(m/f/x", "M/W/D", "h f"): runs of two single letters or more. */
const GENDER_LETTERS = new Set(['m', 'f', 'h', 'v', 'w', 'd', 'x']);
const GENDER_TOKENS = new Set(['mfx', 'fmx', 'mvx', 'vmx', 'hfx', 'fhx', 'mwd', 'mfd', 'fmd']);
const GENDER_WORDS = phrases(['homme femme', 'femme homme', 'man vrouw', 'vrouw man']);

function withoutGender(tokens: readonly string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < tokens.length;) {
    let end = index;
    while (end < tokens.length && GENDER_LETTERS.has(tokens[end]!)) end += 1;
    if (end - index >= 2) index = end;
    else if (GENDER_TOKENS.has(tokens[index]!)) index += 1;
    else kept.push(tokens[index++]!);
  }
  return withoutPhrases(kept, GENDER_WORDS);
}

/** Words that announce a reference: "Job ID 12345", "Réf. 2041", "Vacature 88123". */
const REF_MARKERS = new Set([
  'ref',
  'reference',
  'referentie',
  'id',
  'jobid',
  'req',
  'requisition',
  'vacature',
  'vacaturenummer',
  'vacancy',
  'nr',
  'no',
  'num',
  'numero',
  'n',
]);
/** Words around a figure that make it an amount, never a reference ("4700 EUR"). */
const AMOUNT_WORDS = new Set(['eur', 'euro', 'euros', 'brut', 'bruts', 'bruto', 'gross', 'netto']);
const REFERENCE = /^([a-z]{0,5})(\d{4,})$/;

/**
 * The references of a title, as figures: four figures or more with an optional prefix of
 * letters, never a year (19xx, 20xx) nor an amount. Four figures alone only count after a word
 * such as "ref" or "ID": otherwise they are as often a postal code ("1000 Bruxelles").
 */
function references(tokens: readonly string[]): { refs: string[]; at: Set<number> } {
  const refs = new Set<string>();
  const at = new Set<number>();
  tokens.forEach((token, index) => {
    const match = REFERENCE.exec(token);
    if (!match) return;
    const [, prefix = '', figures = ''] = match;
    const before = tokens[index - 1] ?? '';
    const after = tokens[index + 1] ?? '';
    if (AMOUNT_WORDS.has(after) || before === 'eur') return;
    const marked = REF_MARKERS.has(before) || REF_MARKERS.has(prefix);
    if (figures.length === 4 && prefix === '' && !marked) return;
    if (figures.length === 4 && /^(19|20)\d\d$/.test(figures) && !marked) return;
    refs.add(figures);
    at.add(index);
  });
  return { refs: [...refs].sort(), at };
}

/** Places that say nothing of the job: Brussels, the large cities, the regions, the country. */
const PLACES = phrases([
  'bruxelles',
  'brussels',
  'brussel',
  'bxl',
  'region de bruxelles capitale',
  'bruxelles capitale',
  'brussels capital region',
  'brussels hoofdstedelijk gewest',
  'anderlecht',
  'etterbeek',
  'evere',
  'ixelles',
  'elsene',
  'jette',
  'schaerbeek',
  'schaarbeek',
  'uccle',
  'ukkel',
  'molenbeek',
  'saint gilles',
  'woluwe saint lambert',
  'woluwe saint pierre',
  'zaventem',
  'diegem',
  'machelen',
  'vilvoorde',
  'vilvorde',
  'antwerpen',
  'anvers',
  'antwerp',
  'gent',
  'gand',
  'ghent',
  'liege',
  'luik',
  'namur',
  'namen',
  'charleroi',
  'mons',
  'leuven',
  'louvain',
  'louvain la neuve',
  'mechelen',
  'malines',
  'brugge',
  'bruges',
  'hasselt',
  'kortrijk',
  'courtrai',
  'aalst',
  'alost',
  'oostende',
  'ostende',
  'wavre',
  'waver',
  'nivelles',
  'ottignies',
  'waterloo',
  'la louviere',
  'tournai',
  'arlon',
  'verviers',
  'wallonie',
  'wallonia',
  'region wallonne',
  'walloon region',
  'waals gewest',
  'vlaanderen',
  'flanders',
  'flandre',
  'flemish region',
  'vlaams gewest',
  'belgium',
  'belgique',
  'belgie',
  'belgien',
]);

/** Contract and working time: the same offer is written with or without them. */
const CONTRACTS = phrases([
  'cdi',
  'cdd',
  'freelance',
  'free lance',
  'full time',
  'fulltime',
  'part time',
  'parttime',
  'temps plein',
  'temps partiel',
  'mi temps',
  'voltijds',
  'deeltijds',
  'vast contract',
  'contrat a duree indeterminee',
  'contrat a duree determinee',
]);

/** "Analyst and Developer" and "Analyst & Developer" are the same title. */
const LINKS = new Set(['and', 'et', 'en']);

/** Where a title is cut to find the employer at its start or end ("AG Insurance - Analyst"). */
const SEGMENTS = /\s[-–—|@/]\s|[()[\]]|:\s|\s(?:chez|at|bij)\s/u;

/** "Réf. : 2041" and "Job ID#12345" read as "ref 2041" and "job id 12345", in one segment. */
const MARKER_SIGNS =
  /\b(job\s?id|ref(?:erence|erentie)?|vacature(?:nummer)?|vacancy|req(?:uisition)?|id|nr|no|num(?:ero)?|n)\s*[.:#°]+\s*/gu;

const foldTitle = (title: string) => fold(title).replace(MARKER_SIGNS, '$1 ');

function cleanSegment(segment: string): string[] {
  const tokens = withoutGender(words(segment));
  const { at } = references(tokens);
  const kept = tokens.filter((token, index) => {
    if (at.has(index)) return false;
    // A reference word followed by a code ("ref 123", "Job ID R-12"): both go.
    const next = tokens[index + 1];
    if (REF_MARKERS.has(token) && next !== undefined && /\d/.test(next)) return false;
    if (token === 'job' && next === 'id') return false;
    return true;
  });
  return withoutPhrases(withoutPhrases(kept, PLACES), CONTRACTS).filter(
    (token) => !LINKS.has(token),
  );
}

/** A segment made only of the employer's words (and legal forms) names the employer. */
function namesEmployer(segment: readonly string[], employer: ReadonlySet<string>): boolean {
  const meaningful = segment.filter((word) => !LEGAL_FORMS.has(word));
  return meaningful.length > 0 && meaningful.every((word) => employer.has(word));
}

/**
 * The normalized title: the employer's name dropped when it opens or closes the title, gender
 * marks, references, places, contract words and punctuation removed.
 */
function normalizedTitle(title: string, employer: readonly string[]): string[] {
  const segments = foldTitle(title)
    .split(SEGMENTS)
    .map(cleanSegment)
    .filter((tokens) => tokens.length > 0);
  if (employer.length > 0) {
    const names = new Set(employer);
    if (segments.length > 1 && namesEmployer(segments[0]!, names)) segments.shift();
    if (segments.length > 1 && namesEmployer(segments.at(-1)!, names)) segments.pop();
  }
  const tokens = segments.flat();
  // A title made only of words that were removed ("Bruxelles") keeps its own words.
  return tokens.length > 0 ? tokens : words(title);
}

/** The identity of a posting, for the content key and the merge rules. */
export function identify(title: string, company: string): PostingIdentity {
  const employer = employerWords(company);
  const tokens = normalizedTitle(title, employer);
  const normalized = tokens.join(' ');
  const key = createHash('sha1')
    .update(`${normalized}|${employer.length > 0 ? employer.join(' ') : '?'}`)
    .digest('hex')
    .slice(0, 16);
  return {
    key,
    title: normalized,
    bare: tokens.filter((token) => !/\d/.test(token)).join(' '),
    refs: references(withoutGender(words(foldTitle(title)))).refs,
    employer,
  };
}

/** The same employer up to a name extension, by words: "Sander" and "Sander Brussels". */
export function sameEmployer(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const [short, long] = a.length <= b.length ? [a, new Set(b)] : [b, new Set(a)];
  return short.every((word) => long.has(word));
}

/** Why two postings are one announcement, or null when nothing says so. */
export function mergeReason(a: Comparable, b: Comparable, scope: MergeScope): MergeReason | null {
  const x = a.identity;
  const y = b.identity;
  const common = x.refs.some((ref) => y.refs.includes(ref));
  // Two references that all differ: two offers, whatever the rest says.
  if (!common && x.refs.length > 0 && y.refs.length > 0) return null;
  const named = x.employer.length > 0 && y.employer.length > 0;
  const same = named && sameEmployer(x.employer, y.employer);
  // Two named employers that differ: never merged without a common reference.
  if (named && !same && !common) return null;
  if (x.key === y.key) return 'key';
  if (x.bare === '' || x.bare !== y.bare) return null;
  if (common) return 'reference';
  if (a.url !== null && a.url === b.url) return 'url';
  if (same && (scope === 'batch' || a.source !== b.source)) return 'employer';
  if (scope === 'batch' && !named && x.employer.length + y.employer.length > 0) {
    return 'no_employer';
  }
  return null;
}

/** A posting of the current run of a source. */
export interface IncomingPosting extends Comparable {
  /** Already stored at this source (same identifier): it keeps its announcement. */
  known: { postingId: string; offerId: string } | null;
}

/** A stored posting of an announcement seen within the history window. */
export interface StoredPosting extends Comparable {
  postingId: string;
  offerId: string;
  /** The announcement's latest sighting: the freshest wins a tie. */
  seenAt: Date;
}

export type Placement =
  /** Stored before at this source: never moved, so an undone merge stays undone. */
  | { kind: 'known'; offerId: string }
  /** Joins a stored announcement. */
  | { kind: 'joined'; offerId: string; reason: MergeReason }
  /** Joins the new announcement of an earlier posting of the same run (its index). */
  | { kind: 'grouped'; leader: number; reason: MergeReason }
  /** Starts a new announcement. */
  | { kind: 'new' };

type Target = { offerId: string } | { leader: number };

interface Match {
  rank: number;
  stored: boolean;
  seenAt: number;
  order: number;
  target: Target;
  reason: MergeReason;
}

const better = (a: Match, b: Match) =>
  a.rank - b.rank ||
  Number(a.stored) - Number(b.stored) ||
  b.seenAt - a.seenAt ||
  a.order - b.order;

function indexBy<T>(items: readonly T[], identity: (item: T) => Comparable['identity']) {
  const byKey = new Map<string, number[]>();
  const byBare = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, value: string, index: number) => {
    const list = map.get(value);
    if (list) list.push(index);
    else map.set(value, [index]);
  };
  items.forEach((item, index) => {
    const { key, bare } = identity(item);
    push(byKey, key, index);
    if (bare !== '') push(byBare, bare, index);
  });
  // Every rule needs the same key or the same bare title: only those are compared.
  return (of: Comparable['identity']) =>
    new Set([...(byKey.get(of.key) ?? []), ...(of.bare ? (byBare.get(of.bare) ?? []) : [])]);
}

/**
 * Places each posting of a run: its stored announcement, a stored one it joins, the new one of
 * an earlier posting of the run, or a new one. The run's own postings are compared with the
 * `batch` rules (`history` when regrouping stored postings), stored postings with the `history`
 * rules. Order matters: a posting only joins the postings placed before it, as an announcement
 * found by two sources stays under the first one called.
 */
export function placePostings(
  incoming: readonly IncomingPosting[],
  stored: readonly StoredPosting[],
  scope: MergeScope = 'batch',
): Placement[] {
  const placements: Array<Placement | undefined> = incoming.map((posting) =>
    posting.known ? { kind: 'known', offerId: posting.known.offerId } : undefined,
  );
  const ownIds = new Set(incoming.flatMap((posting) => posting.known?.postingId ?? []));
  const others = stored.filter((posting) => !ownIds.has(posting.postingId));
  const sameRun = indexBy(incoming, (posting) => posting.identity);
  const history = indexBy(others, (posting) => posting.identity);
  const target = (index: number): Target => {
    const placed = placements[index]!;
    if (placed.kind === 'known' || placed.kind === 'joined') return { offerId: placed.offerId };
    if (placed.kind === 'grouped') return { leader: placed.leader };
    return { leader: index };
  };

  incoming.forEach((posting, index) => {
    if (placements[index]) return;
    let best: Match | null = null;
    const consider = (match: Match) => {
      if (!best || better(match, best) < 0) best = match;
    };
    for (const other of sameRun(posting.identity)) {
      if (other === index || !placements[other]) continue;
      const reason = mergeReason(incoming[other]!, posting, scope);
      if (reason) {
        const rank = MERGE_REASONS.indexOf(reason);
        consider({ rank, stored: false, seenAt: 0, order: other, target: target(other), reason });
      }
    }
    for (const other of history(posting.identity)) {
      const candidate = others[other]!;
      const reason = mergeReason(candidate, posting, 'history');
      if (reason) {
        consider({
          rank: MERGE_REASONS.indexOf(reason),
          stored: true,
          seenAt: candidate.seenAt.getTime(),
          order: other,
          target: { offerId: candidate.offerId },
          reason,
        });
      }
    }
    const found = best as Match | null;
    placements[index] = !found
      ? { kind: 'new' }
      : 'offerId' in found.target
        ? { kind: 'joined', offerId: found.target.offerId, reason: found.reason }
        : { kind: 'grouped', leader: found.target.leader, reason: found.reason };
  });
  return placements as Placement[];
}
