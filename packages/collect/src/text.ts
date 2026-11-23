// Text helpers shared by the common format, the title filter and the connectors.

/** Letters that Unicode does not decompose into a base letter and an accent. */
const LIGATURES: Record<string, string> = { œ: 'oe', æ: 'ae', ß: 'ss', ø: 'o', ł: 'l', đ: 'd' };

/** Without accents: "Développeur" becomes "Developpeur" (Adzuna does not understand accents). */
export function stripAccents(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[œæßøłđ]/giu, (letter) => {
      const plain = LIGATURES[letter.toLowerCase()] ?? letter;
      return letter === letter.toLowerCase() ? plain : plain.toUpperCase();
    })
    .normalize('NFC');
}

/** How titles and expressions are compared: no accents, lower case, single spaces. */
export function fold(value: string): string {
  return cleanLine(stripAccents(value)).toLowerCase();
}

/** One line: every run of white space becomes one space, invisible characters go. */
export function cleanLine(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim();
}

/** At most `max` characters, cut after a word when one ends close enough, then "…". */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let cut = value.slice(0, max - 1);
  // Never leave half of a character written with two code units.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(' ');
  if (space >= max * 0.8) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Plain text out of a snippet that carries markup (Adzuna's <strong>): tags dropped, common
 * entities decoded. Never used to render: the interface shows offers as text only.
 */
export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (entity, name: string) => {
      if (name.startsWith('#x') || name.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      }
      if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
      return ENTITIES[name.toLowerCase()] ?? entity;
    });
}

/** "LA LOUVIÈRE" becomes "La Louvière", "BRAINE-L'ALLEUD" "Braine-L'alleud". */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /(^|[\s-])(\p{L})/gu,
      (_match, before: string, letter: string) => `${before}${letter.toUpperCase()}`,
    );
}
