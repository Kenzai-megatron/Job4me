import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

// The pure part of `pnpm geonames` (ADR 0017, decision D6): from the three GeoNames files of
// Belgium (postal codes, places, alternate names; CC BY 4.0) to the versioned localities file.
// The downloaded files are data only: read as text, never run.

/** One locality of the derived file: a place name with its postal codes and coordinates. */
export interface Locality {
  name: string;
  /** Its other names (French, Dutch, German, English): Malines for Mechelen, Elsene for Ixelles. */
  names: string[];
  postalCodes: string[];
  latitude: number;
  longitude: number;
  /** BRU, VLG or WAL. */
  region: string;
  province: string;
}

/** The content of one file of a ZIP archive (stored or deflated), from its central directory. */
export function readZipEntry(zip: Buffer, name: string): Buffer {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a ZIP archive');
  const entries = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  for (let index = 0; index < entries; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('damaged ZIP directory');
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const entryName = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (entryName === name) {
      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('damaged ZIP entry');
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`unsupported ZIP compression ${method}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${name} missing from the archive`);
}

/** How names are compared: no accents, lower case, letters and figures only. */
export function foldKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const rows = (text: string) =>
  text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.split('\t'));

/** Straight-line distance in kilometres. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Places of the gazetteer whose names may complete a locality: towns, sections, municipalities. */
const PLACE = /^(P\.PPL[A-Z0-9]*|A\.ADM4)$/;
/** Official languages and English; names without a language are the usual local variants. */
const LANGUAGES = new Set(['fr', 'nl', 'de', 'en', '']);
/** A plain place name: Latin letters, spaces, hyphens and apostrophes ("Braine-l'Alleud"). */
const PLAIN = /^[\p{Script=Latin}][\p{Script=Latin}\s'’.-]*$/u;
/** Names of the administration rather than of the place ("Arrondissement de Namur"). */
const ADMINISTRATIVE =
  /^(arrondissement|bezirk|commune|gemeente|stad|ville|city|province|provincie|district|canton|kanton|municipality)\b/i;
/** A feature of the gazetteer within this distance of a locality of the same name is that place. */
const SAME_PLACE_KM = 10;

/**
 * The localities: every place name of the postal codes file, grouped by name and province, with
 * the names in French, Dutch, German and English of the places of the same name nearby.
 */
export function deriveLocalities(files: {
  postal: string;
  places: string;
  alternates: string;
}): Locality[] {
  // Alternate names of the places, by GeoNames identifier: current, official languages only.
  const alternates = new Map<string, string[]>();
  for (const [, id, language, name, , , colloquial, historic] of rows(files.alternates)) {
    if (!id || !name || !LANGUAGES.has(language ?? '') || colloquial === '1' || historic === '1') {
      continue;
    }
    if (!PLAIN.test(name) || ADMINISTRATIVE.test(name)) continue;
    const list = alternates.get(id);
    if (list) list.push(name);
    else alternates.set(id, [name]);
  }
  // Places by every key they answer to.
  const byKey = new Map<string, Array<{ names: string[]; at: [number, number] }>>();
  for (const [id, name, ascii, , lat, lon, featureClass, featureCode] of rows(files.places)) {
    if (!id || !name || !PLACE.test(`${featureClass}.${featureCode}`)) continue;
    const names = [name, ...(alternates.get(id) ?? [])].filter(
      (candidate) => PLAIN.test(candidate) && !ADMINISTRATIVE.test(candidate),
    );
    const place = { names, at: [Number(lat), Number(lon)] as [number, number] };
    for (const key of new Set([...names, ascii ?? ''].map(foldKey).filter(Boolean))) {
      const list = byKey.get(key);
      if (list) list.push(place);
      else byKey.set(key, [place]);
    }
  }

  const grouped = new Map<string, Locality & { lowest: string }>();
  for (const [, code, name, , region, province, provinceCode, , , lat, lon] of rows(files.postal)) {
    if (!code || !name || !/^\d{4}$/.test(code)) continue;
    const key = `${foldKey(name)}|${provinceCode ?? ''}`;
    const at: [number, number] = [Number(lat), Number(lon)];
    const known = grouped.get(key);
    if (known) {
      known.postalCodes.push(code);
      // The coordinates of the lowest postal code: the centre, for a city of several codes.
      if (code < known.lowest) {
        [known.latitude, known.longitude, known.lowest] = [at[0], at[1], code];
      }
      continue;
    }
    grouped.set(key, {
      name,
      names: [],
      postalCodes: [code],
      latitude: at[0],
      longitude: at[1],
      region: region ?? '',
      province: province ?? '',
      lowest: code,
    });
  }

  const localities: Locality[] = [];
  for (const { lowest: _lowest, ...locality } of grouped.values()) {
    const nearby = (byKey.get(foldKey(locality.name)) ?? []).filter(
      (place) => haversineKm(place.at, [locality.latitude, locality.longitude]) <= SAME_PLACE_KM,
    );
    const seen = new Set([locality.name.toLowerCase()]);
    const names: string[] = [];
    for (const name of nearby.flatMap((place) => place.names)) {
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      names.push(name);
    }
    localities.push({
      ...locality,
      names: names.sort((a, b) => a.localeCompare(b, 'fr')),
      postalCodes: [...new Set(locality.postalCodes)].sort(),
      latitude: Math.round(locality.latitude * 1e5) / 1e5,
      longitude: Math.round(locality.longitude * 1e5) / 1e5,
    });
  }
  return localities.sort(
    (a, b) =>
      a.postalCodes[0]!.localeCompare(b.postalCodes[0]!) || a.name.localeCompare(b.name, 'fr'),
  );
}

const clean = (value: string) => value.replace(/[\t\n\r|]/g, ' ').trim();

/** The versioned file: a header with the attribution, then one locality per line. */
export function toTsv(localities: readonly Locality[], generatedOn: string): string {
  const header = [
    '# Localités belges dérivées de GeoNames (https://www.geonames.org), licence CC BY 4.0.',
    `# Fichiers BE des codes postaux, des lieux et des noms alternatifs, lus le ${generatedOn}.`,
    '# Régénéré par `pnpm geonames` (ADR 0017) ; chargé en base par la migration.',
    'id\tname\tnames\tpostal_codes\tlatitude\tlongitude\tregion\tprovince',
  ];
  const lines = localities.map((locality, index) =>
    [
      String(index + 1),
      clean(locality.name),
      locality.names.map(clean).join('|'),
      locality.postalCodes.join(','),
      locality.latitude.toFixed(5),
      locality.longitude.toFixed(5),
      clean(locality.region),
      clean(locality.province),
    ].join('\t'),
  );
  return `${[...header, ...lines].join('\n')}\n`;
}

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
