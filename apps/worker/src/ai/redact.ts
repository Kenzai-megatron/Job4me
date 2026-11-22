// Local redaction of a CV before it reaches the AI (ADR 0009; plan, section 6, threat 4).
// Contact details, the known identity, addresses, personal data and the "References" section
// never leave the machine. What is found is kept to be proposed to the Identity rubric directly.

export interface KnownIdentity {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  commune?: string | null;
}

export interface FoundIdentity {
  emails: string[];
  phones: string[];
  /** The first line when it reads like a person's name. */
  names: string[];
}

export interface Redaction {
  text: string;
  found: FoundIdentity;
  /** How many replacements, by kind: for tests and logs, never the values. */
  counts: Record<string, number>;
}

const EMAIL = /[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.\p{L}{2,}/giu;
const LINK =
  /\b(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|be|eu|net|org|io|fr|nl|lu|de)\/\S*/giu;
/** Belgian national register number (YY.MM.DD-XXX.CC). */
const NATIONAL_NUMBER = /\b\d{2}[.\s]?\d{2}[.\s]?\d{2}[-\s]\d{3}[.\s]?\d{2}\b/g;
/** International (+32, 0032) or national (0…) numbers; their digits are checked below. */
const PHONE =
  /(?:\+|00)\d{1,3}[\s./-]?(?:\(0\)[\s./-]?)?\d{1,4}(?:[\s./-]?\d{2,4}){1,4}|\b0\d{1,3}(?:[\s./-]?\d{2,4}){2,4}\b/g;
/** A date or a range of dates is never a phone number ("09/2019 06/2021"). */
const DATE_LIKE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$|(?:^|[\s./-])(?:19|20)\d{2}(?:$|[\s./-])/;
/**
 * Whole words, accents included: JavaScript's \\b only knows ASCII letters, so "né" would match
 * inside "néerlandais". Each list becomes (?<!letter)(?:a|b|c)(?!letter).
 */
function words(list: string, flags = 'giu'): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${list})(?![\\p{L}\\p{N}])`, flags);
}
function heading(list: string): RegExp {
  return new RegExp(`^\\s*(?:${list})(?![\\p{L}\\p{N}])`, 'iu');
}

const STREET_WORDS =
  'rue|avenue|av\\.|boulevard|bd|chaussée|place|square|clos|allée|chemin|impasse|quai|drève|straat|laan|lei|plein|steenweg|dreef|street|road';
const STREET = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${STREET_WORDS})(?![\\p{L}\\p{N}])[^\\n,]{0,60}?\\d{1,4}\\s?[a-z]?(?![\\p{L}\\p{N}])(?:\\s*(?:bte|bus|boîte)\\s*\\d+)?(?:,?\\s*(?:B-)?[1-9]\\d{3}\\s+[\\p{L}' -]{2,40})?`,
  'giu',
);
const PERSONAL = new RegExp(
  `${words('née?|date de naissance|lieu de naissance|nationalité|état civil|situation familiale|geboren|geboortedatum|nationaliteit|burgerlijke staat|date of birth|nationality|marital status').source}[^\\n]{0,60}`,
  'giu',
);
/** A heading that opens the references section, then any heading that closes it. */
const REFERENCES_HEADING = heading('références|referenties|references|referees');
const SECTION_HEADING = heading(
  "expériences?|formations?|études|compétences|langues|certifications?|projets|centres d'intérêt|loisirs|hobbies|bénévolat|ervaring|opleiding|vaardigheden|talen|experience|education|skills|languages|projects|interests|volunteering",
);
/** Words of a title or a heading: such a first line is not a name. */
const NOT_A_NAME = words(
  'cv|curriculum|vitae|profil|profile|expérience|experience|formation|resume|résumé|analyste|analyst|ingénieur|engineer|manager|développeur|developer|consultant|comptable|accountant|assistant|assistante|technicien|gestionnaire|chef|responsable|directeur|directrice|stagiaire|data|business|junior|senior',
  'iu',
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A known value, whatever its case and accents (the text is matched in NFD form). */
function loosePattern(value: string): RegExp {
  const letters = [...value.normalize('NFD').replace(/\p{M}/gu, '')].map((char) =>
    /\s/.test(char) ? '\\s+' : `${escapeRegExp(char)}\\p{M}*`,
  );
  return new RegExp(`(?<![\\p{L}\\p{N}])${letters.join('')}(?![\\p{L}\\p{N}])`, 'giu');
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function looksLikeName(line: string): boolean {
  const words = line.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4 || line.length > 60 || NOT_A_NAME.test(line)) {
    return false;
  }
  return words.every(
    (word) => /^\p{Lu}[\p{L}'’-]+$/u.test(word) || /^[\p{Lu}'’-]{2,}$/u.test(word),
  );
}

/** Drops the references section: names and contacts of third parties (ADR 0009). */
function withoutReferences(text: string): { text: string; dropped: boolean } {
  const kept: string[] = [];
  let skipping = false;
  let dropped = false;
  for (const line of text.split('\n')) {
    if (REFERENCES_HEADING.test(line)) {
      skipping = true;
      dropped = true;
      kept.push('[références retirées]');
      continue;
    }
    if (skipping && SECTION_HEADING.test(line)) skipping = false;
    if (!skipping) kept.push(line);
  }
  return { text: kept.join('\n'), dropped };
}

export function redactCv(source: string, known: KnownIdentity): Redaction {
  const counts: Record<string, number> = {};
  const found: FoundIdentity = { emails: [], phones: [], names: [] };
  const count = (kind: string) => (counts[kind] = (counts[kind] ?? 0) + 1);
  const replace = (
    pattern: RegExp,
    kind: string,
    label: string,
    keep?: (match: string) => boolean,
  ) => {
    text = text.replace(pattern, (match) => {
      if (keep && !keep(match)) return match;
      count(kind);
      return label;
    });
  };

  // Patterns hold accented words: they run on the composed (NFC) text.
  const references = withoutReferences(source.normalize('NFC'));
  let text = references.text;
  if (references.dropped) count('references');

  const firstLine = text.split('\n').find((line) => line.trim() !== '');
  if (firstLine && looksLikeName(firstLine)) found.names.push(firstLine.trim());

  replace(EMAIL, 'email', '[e-mail]', (match) => {
    found.emails.push(match);
    return true;
  });
  replace(LINK, 'link', '[lien]');
  replace(NATIONAL_NUMBER, 'personal', '[donnée personnelle retirée]');
  replace(PHONE, 'phone', '[téléphone]', (match) => {
    const number = digits(match);
    if (number.length < 9 || number.length > 15 || DATE_LIKE.test(match.trim())) return false;
    found.phones.push(match.trim());
    return true;
  });
  replace(STREET, 'address', '[adresse]');
  replace(PERSONAL, 'personal', '[donnée personnelle retirée]');

  // Known values match whatever their accents: on the decomposed (NFD) text.
  text = text.normalize('NFD');
  // The known full name, each of its parts (a surname alone), then the name found on top.
  const fullName = known.fullName?.trim();
  const parts = fullName ? fullName.split(/\s+/).filter((part) => part.length >= 3) : [];
  for (const value of [fullName, ...parts, ...found.names]) {
    if (value) replace(loosePattern(value), 'name', '[nom]');
  }
  if (known.email?.trim()) replace(loosePattern(known.email.trim()), 'email', '[e-mail]');
  if (known.commune?.trim()) replace(loosePattern(known.commune.trim()), 'commune', '[commune]');
  const knownPhone = known.phone ? digits(known.phone) : '';
  if (knownPhone.length >= 9) {
    const tail = knownPhone.slice(-8);
    replace(/[+\d][\d\s./()-]{7,}\d/g, 'phone', '[téléphone]', (match) =>
      digits(match).endsWith(tail),
    );
  }
  return { text: text.normalize('NFC'), found, counts };
}
