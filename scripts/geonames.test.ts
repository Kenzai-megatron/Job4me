import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { deriveLocalities, foldKey, readZipEntry, sha256, toTsv } from './geonames-lib';

// `pnpm geonames` on made-up extracts laid out like the GeoNames files (tab-separated).

/** A ZIP archive with one file per entry, stored or deflated, as GeoNames serves them. */
function zip(entries: Array<{ name: string; text: string; deflate: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const { name, text, deflate } of entries) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflate ? deflateRawSync(raw) : raw;
    const fileName = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, data);
    directory.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...directory, end]);
}

const tsv = (rows: string[][]) => rows.map((row) => row.join('\t')).join('\n');

const postal = tsv([
  [
    'BE',
    '2800',
    'Mechelen',
    'Flanders',
    'VLG',
    'Provincie Antwerpen',
    'VAN',
    'Arr',
    '12',
    '51.0257',
    '4.4776',
    '4',
  ],
  [
    'BE',
    '2800',
    'Walem',
    'Flanders',
    'VLG',
    'Provincie Antwerpen',
    'VAN',
    'Arr',
    '12',
    '51.0671',
    '4.4584',
    '4',
  ],
  [
    'BE',
    '2018',
    'Antwerpen',
    'Flanders',
    'VLG',
    'Provincie Antwerpen',
    'VAN',
    'Arr',
    '11',
    '51.2199',
    '4.4035',
    '4',
  ],
  [
    'BE',
    '2000',
    'Antwerpen',
    'Flanders',
    'VLG',
    'Provincie Antwerpen',
    'VAN',
    'Arr',
    '11',
    '51.2200',
    '4.4000',
    '4',
  ],
  [
    'BE',
    '1050',
    'Ixelles',
    'Bruxelles-Capitale',
    'BRU',
    'Bruxelles-Capitale',
    'BRU',
    'Arr',
    '21',
    '50.8333',
    '4.3667',
    '4',
  ],
]);
const places = tsv([
  ['1', 'Mechelen', 'Mechelen', '', '51.02574', '4.47762', 'P', 'PPL'],
  ['2', 'Mechelen', 'Mechelen', '', '50.97990', '5.69350', 'P', 'PPL'],
  ['3', 'Antwerpen', 'Antwerpen', '', '51.21989', '4.40346', 'P', 'PPLA'],
  ['4', 'Ixelles', 'Ixelles', '', '50.83333', '4.36667', 'P', 'PPL'],
  ['5', 'Mechelen station', 'Mechelen station', '', '51.0175', '4.4823', 'S', 'RSTN'],
]);
const alternates = tsv([
  ['10', '1', 'fr', 'Malines', '', '', '', ''],
  ['11', '1', 'de', 'Mecheln', '', '', '', ''],
  ['12', '1', 'en', 'Mechlin', '', '', '', '1'],
  ['13', '2', 'fr', 'Malines-sur-Meuse', '', '', '', ''],
  ['14', '3', 'en', 'Antwerp', '1', '', '', ''],
  ['15', '3', 'fr', 'Anvers', '', '', '', ''],
  ['16', '3', 'ru', 'Антверпен', '', '', '', ''],
  ['17', '4', 'nl', 'Elsene', '1', '', '', ''],
  ['18', '4', '', 'Ixelles/Elsene', '', '', '', ''],
  ['19', '4', 'fr', 'Commune d’Ixelles', '', '', '', ''],
  ['20', '4', 'link', 'https://example.org/ixelles', '', '', '', ''],
  ['21', '5', 'fr', 'Gare de Malines', '', '', '', ''],
]);

describe('readZipEntry', () => {
  it('reads a stored or a deflated file of a GeoNames archive', () => {
    const archive = zip([
      { name: 'readme.txt', text: 'CC BY 4.0', deflate: false },
      { name: 'BE.txt', text: postal, deflate: true },
    ]);
    expect(readZipEntry(archive, 'BE.txt').toString('utf8')).toBe(postal);
    expect(readZipEntry(archive, 'readme.txt').toString('utf8')).toBe('CC BY 4.0');
    expect(() => readZipEntry(archive, 'FR.txt')).toThrow(/missing/);
    expect(() => readZipEntry(Buffer.from('not a zip'), 'BE.txt')).toThrow(/not a ZIP/);
  });
});

describe('deriveLocalities', () => {
  const localities = deriveLocalities({ postal, places, alternates });
  const named = (name: string) => localities.find((locality) => locality.name === name)!;

  it('groups the postal codes of a place, at the coordinates of the lowest one', () => {
    expect(localities.map((locality) => locality.name)).toEqual([
      'Ixelles',
      'Antwerpen',
      'Mechelen',
      'Walem',
    ]);
    expect(named('Antwerpen')).toMatchObject({
      postalCodes: ['2000', '2018'],
      latitude: 51.22,
      longitude: 4.4,
      region: 'VLG',
      province: 'Provincie Antwerpen',
    });
  });

  it('takes the other names of the place nearby, current and plain ones only', () => {
    expect(named('Mechelen').names).toEqual(['Malines', 'Mecheln']);
    expect(named('Antwerpen').names).toEqual(['Antwerp', 'Anvers']);
    expect(named('Ixelles').names).toEqual(['Elsene']);
    expect(named('Walem').names).toEqual([]);
  });

  it('writes a file with its attribution, whose fingerprint follows its content', () => {
    const file = toTsv(localities, '2026-11-24');
    expect(file.split('\n')[0]).toContain('GeoNames');
    expect(file.split('\n')[0]).toContain('CC BY 4.0');
    expect(file).toContain('Mechelen\tMalines|Mecheln\t2800\t51.02570\t4.47760\tVLG');
    expect(sha256(file)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(toTsv(localities, '2026-11-25'))).not.toBe(sha256(file));
  });

  it('compares names without accents, case or signs', () => {
    expect(foldKey("Braine-l'Alleud")).toBe('braine l alleud');
    expect(foldKey('LIÈGE')).toBe('liege');
  });
});
