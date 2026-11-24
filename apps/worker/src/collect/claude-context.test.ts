import { describe, expect, it } from 'vitest';
import { claudeOfferOf } from './claude-context';

// The offer as Claude reads it (decision D2), and the cost of reading it (security review of
// phase 3, finding 1): fictitious offers only.

const facts = {
  title: 'Comptable (H/F/X)',
  company: 'Exemple SA',
  location: 'Malines',
  description: 'Vous tenez la comptabilité. Contact : rh@example.org, +32 2 123 45 67.',
  details: 'CDI · temps plein',
  salary: null,
  placeStatus: 'found',
  placeName: 'Mechelen',
  distanceKm: 27,
  remote: 'hybrid',
};

describe('the offer as Claude reads it', () => {
  it('names the place and distance, and never the recruiter’s contacts', () => {
    const offer = claudeOfferOf(facts);
    expect(offer.place).toBe('Mechelen [27 km] · télétravail partiel');
    expect(offer.conditions).toBe('CDI · temps plein');
    expect(offer.description).not.toMatch(/example\.org|123 45 67/);
    expect(claudeOfferOf({ ...facts, placeStatus: 'unknown', distanceKm: null }).place).toBe(
      'Malines [distance inconnue] · télétravail partiel',
    );
  });

  it('reads a long unbroken text in bounded time, and only what a prompt may carry', () => {
    const started = performance.now();
    const offer = claudeOfferOf({ ...facts, description: 'a.'.repeat(25_000) });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(offer.description.length).toBeLessThanOrEqual(10_000);
  });
});
