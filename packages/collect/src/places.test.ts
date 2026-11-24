import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Gazetteer, type GazetteerEntry, remoteOf, roadKm } from './places';

// The versioned GeoNames file (public data), as the migration loads it.
const FILE = join(import.meta.dirname, '..', '..', 'db', 'drizzle', 'data', 'localities.tsv');
const entries: GazetteerEntry[] = readFileSync(FILE, 'utf8')
  .split('\n')
  .filter((line) => line && !line.startsWith('#') && !line.startsWith('id\t'))
  .map((line) => {
    const [, name, names, codes, latitude, longitude] = line.split('\t');
    return {
      name: name!,
      names: names ? names.split('|') : [],
      postalCodes: codes!.split(','),
      latitude: Number(latitude),
      longitude: Number(longitude),
    };
  });
const gazetteer = new Gazetteer(entries, {
  roadFactor: 1.25,
  ambiguityKm: 15,
  yearsFrom: 2020,
  yearsTo: 2035,
});
const where = (text: string | null) => {
  const place = gazetteer.locate(text);
  return place.status === 'found' ? `${place.postalCode} ${place.name}` : place.status;
};

describe('Gazetteer.locate', () => {
  it('reads the places of the plan (threat 5)', () => {
    expect(where('Gent, Flemish Region, Belgium')).toBe('9000 Gent');
    expect(where('Belgium')).toBe('unknown');
    expect(where('2026')).toBe('unknown');
    expect(where('Luxembourg')).toBe('abroad');
    expect(where('Montrouge, France')).toBe('abroad');
  });

  it('reads both names of the communes, and English ones', () => {
    expect(where('Malines')).toBe('2800 Mechelen');
    expect(where('Elsene')).toBe('1050 Ixelles');
    expect(where('Anvers')).toBe('2000 Antwerpen');
    expect(where('Antwerp Metropolitan Area')).toBe('2000 Antwerpen');
    expect(where('Brussels')).toBe('1000 Bruxelles');
    expect(where('Brussel')).toBe('1000 Bruxelles');
    expect(where('Luik')).toBe('4000 Liège');
    expect(where('LIEGE')).toBe('4000 Liège');
    expect(where('Louvain-la-Neuve')).toBe('1348 Louvain-la-Neuve');
    expect(where('louvain la neuve')).toBe('1348 Louvain-la-Neuve');
    expect(where("Braine-l'Alleud")).toBe("1420 Braine-l'Alleud");
  });

  it('falls back on the postal code, never on a year', () => {
    expect(where('1000')).toBe('1000 Bruxelles');
    expect(where('Bruxelles (1000)')).toBe('1000 Bruxelles');
    expect(where('B-1348')).toBe('1348 Louvain-la-Neuve');
    expect(where('1300 Wavre')).toBe('1300 Wavre');
    expect(where('2030')).toBe('unknown');
  });

  it('never places anything on a country or a region', () => {
    for (const text of [
      'Belgique',
      'België',
      'Vlaanderen',
      'Wallonie',
      'Flemish Region',
      'Province de Liège',
      'Provincie Antwerpen',
      'Hainaut',
      'Brabant wallon',
      'Limburg',
    ]) {
      expect(where(text)).toBe('unknown');
    }
    expect(where('Région de Bruxelles-Capitale')).toBe('1000 Bruxelles');
    expect(where('Wavre, Brabant wallon')).toBe('1300 Wavre');
  });

  it('does not guess a name carried by places far apart', () => {
    expect(where('Halle')).toBe('unknown');
    expect(where('1500 Halle')).toBe('1500 Halle');
    expect(where('Aalst')).toBe('unknown');
    expect(where('Aalst (9300)')).toBe('9300 Aalst');
  });

  it('takes a foreign country for abroad, Luxembourg alone too', () => {
    expect(where('Lille, France')).toBe('abroad');
    expect(where('Amsterdam, Netherlands')).toBe('abroad');
    expect(where('Arlon, Luxembourg')).toBe('6700 Arlon');
    expect(where('Arlon, Luxembourg, Belgium')).toBe('6700 Arlon');
  });

  it('leaves the rest unknown, work modes aside', () => {
    expect(where(null)).toBe('unknown');
    expect(where('?')).toBe('unknown');
    expect(where('Remote')).toBe('unknown');
    expect(where('Bruxelles (hybride)')).toBe('1000 Bruxelles');
    expect(where('Diegem (Zaventem)')).toBe('1831 Diegem');
    expect(where('Quelque part')).toBe('unknown');
  });

  it('reads the base city of the profile from its name or its postal code', () => {
    const base = gazetteer.locateBase('Bruxelles', '1000');
    expect(base).toMatchObject({ status: 'found', name: 'Bruxelles', postalCode: '1000' });
    expect(gazetteer.locateBase(null, '1348')).toMatchObject({ name: 'Louvain-la-Neuve' });
    expect(gazetteer.locateBase('Nulle part', null)).toEqual({ status: 'unknown' });
  });
});

describe('roadKm', () => {
  it('is the straight line × the road factor, in whole kilometres', () => {
    const brussels = gazetteer.locate('Bruxelles');
    const mechelen = gazetteer.locate('Mechelen');
    if (brussels.status !== 'found' || mechelen.status !== 'found') throw new Error('not found');
    expect(roadKm(brussels, mechelen, 1)).toBe(21);
    expect(roadKm(brussels, mechelen, 1.25)).toBe(27);
    expect(roadKm(brussels, brussels, 1.25)).toBe(0);
  });
});

describe('remoteOf', () => {
  it('reads a work mode stated as a place or a part of the title', () => {
    expect(remoteOf({ location: 'Belgium (Remote)' })).toBe('full');
    expect(remoteOf({ location: 'Télétravail' })).toBe('full');
    expect(remoteOf({ location: 'Bruxelles (hybride)' })).toBe('hybrid');
    expect(remoteOf({ title: 'Business Analyst (Remote)' })).toBe('full');
    expect(remoteOf({ title: 'Comptable - Hybrid' })).toBe('hybrid');
    expect(remoteOf({ title: 'Remote Sensing Engineer' })).toBeNull();
    expect(remoteOf({ title: 'Mécanicien véhicule hybride' })).toBeNull();
  });

  it('reads a description, negations aside', () => {
    expect(remoteOf({ description: 'Poste en 100 % télétravail.' })).toBe('full');
    expect(remoteOf({ description: 'Fully remote, anywhere in Belgium.' })).toBe('full');
    expect(remoteOf({ description: 'Télétravail deux jours par semaine.' })).toBe('hybrid');
    expect(remoteOf({ description: 'Mogelijkheid tot thuiswerk.' })).toBe('hybrid');
    expect(remoteOf({ description: 'Pas de télétravail possible.' })).toBeNull();
    expect(remoteOf({ description: 'Remote control of the machines.' })).toBeNull();
    expect(remoteOf({})).toBeNull();
  });
});
