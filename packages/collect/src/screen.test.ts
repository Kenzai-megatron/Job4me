import { describe, expect, it } from 'vitest';
import { contractsOf, languagesIn, screen, type ScreenOffer, type ScreenProfile } from './screen';

const profile: ScreenProfile = {
  excludedCompanies: ['Deloitte', 'Banque Exemple Digital SA'],
  radiusKm: 40,
  acceptsRemote: true,
  contracts: ['permanent', 'fixed_term'],
  excludedLanguages: ['de'],
  maxAgeDays: 60,
  today: '2026-11-24',
};
const offer = (extra: Partial<ScreenOffer> = {}): ScreenOffer => ({
  manual: false,
  companies: ['Autre SA'],
  postedOn: '2026-11-20',
  placeStatus: 'found',
  distanceKm: 12,
  remote: null,
  contracts: [],
  languages: [],
  ...extra,
});

describe('screen', () => {
  it('keeps an offer that breaks no certain criterion', () => {
    expect(screen(offer(), profile)).toBeNull();
    expect(
      screen(offer({ placeStatus: 'unknown', distanceKm: null, postedOn: null }), profile),
    ).toBeNull();
  });

  it('sets aside an excluded employer, compared by words, never a narrower name', () => {
    expect(screen(offer({ companies: ['Deloitte Digital'] }), profile)).toBe('excluded_company');
    expect(screen(offer({ companies: ['?', 'DELOITTE'] }), profile)).toBe('excluded_company');
    expect(screen(offer({ companies: ['Banque Exemple Digital'] }), profile)).toBe(
      'excluded_company',
    );
    expect(screen(offer({ companies: ['Banque Exemple'] }), profile)).toBeNull();
    expect(screen(offer({ companies: ['Deloittex'] }), profile)).toBeNull();
  });

  it('sets aside an ad older than the limit when its date is known', () => {
    expect(screen(offer({ postedOn: '2026-09-25' }), profile)).toBeNull();
    expect(screen(offer({ postedOn: '2026-09-24' }), profile)).toBe('too_old');
  });

  it('sets aside a place abroad or beyond the radius, unless remote work is accepted', () => {
    expect(screen(offer({ distanceKm: 41 }), profile)).toBe('too_far');
    expect(screen(offer({ distanceKm: 40 }), profile)).toBeNull();
    expect(screen(offer({ distanceKm: 90, remote: 'hybrid' }), profile)).toBeNull();
    expect(screen(offer({ distanceKm: 90, remote: 'full' }), profile)).toBeNull();
    const onSite = { ...profile, acceptsRemote: false };
    expect(screen(offer({ distanceKm: 90, remote: 'full' }), onSite)).toBe('too_far');
    expect(screen(offer({ placeStatus: 'abroad', distanceKm: null }), profile)).toBe('abroad');
    expect(screen(offer({ placeStatus: 'abroad', remote: 'hybrid' }), profile)).toBe('abroad');
    expect(screen(offer({ placeStatus: 'abroad', remote: 'full' }), profile)).toBeNull();
  });

  it('sets aside a language or a contract given as a field and ruled out', () => {
    expect(screen(offer({ languages: ['fr', 'de'] }), profile)).toBe('language');
    expect(screen(offer({ languages: ['nl'] }), profile)).toBeNull();
    expect(screen(offer({ contracts: ['interim'] }), profile)).toBe('contract');
    expect(screen(offer({ contracts: ['interim', 'permanent'] }), profile)).toBeNull();
    expect(screen(offer({ contracts: ['interim'] }), { ...profile, contracts: [] })).toBeNull();
  });

  it('never sets aside an offer added by hand', () => {
    expect(
      screen(offer({ manual: true, companies: ['Deloitte'], distanceKm: 300 }), profile),
    ).toBeNull();
  });
});

describe('contractsOf', () => {
  it('reads the labels of the sources', () => {
    expect(contractsOf('Durée indéterminée')).toEqual(['permanent']);
    expect(contractsOf('Durée déterminée')).toEqual(['fixed_term']);
    expect(contractsOf('Intérimaire avec option sur durée indéterminée').sort()).toEqual([
      'interim',
      'permanent',
    ]);
    expect(contractsOf('Interim')).toEqual(['interim']);
    expect(contractsOf('permanent')).toEqual(['permanent']);
    expect(contractsOf('contract')).toEqual(['fixed_term']);
    expect(contractsOf('Contrat de remplacement')).toEqual(['fixed_term']);
    expect(contractsOf('Job étudiant')).toEqual(['student_job']);
    expect(contractsOf('Indépendant')).toEqual(['freelance']);
    expect(contractsOf('Temps plein')).toEqual([]);
    expect(contractsOf(null)).toEqual([]);
  });
});

describe('languagesIn', () => {
  it('reads languages by any of their names', () => {
    expect(languagesIn('Néerlandais')).toEqual(['nl']);
    expect(languagesIn('Allemand exigé, anglais un atout')).toEqual(['de', 'en']);
    expect(languagesIn('Deutsch')).toEqual(['de']);
    expect(languagesIn('Bonne humeur')).toEqual([]);
  });
});
