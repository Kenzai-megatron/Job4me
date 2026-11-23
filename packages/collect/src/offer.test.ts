import { describe, expect, it } from 'vitest';
import { cleanOffer } from './offer';
import { cleanLine, fold, stripAccents, truncate } from './text';

const raw = {
  externalId: ' 123 ',
  title: '  Comptable  (H/F/X)\n',
  url: 'https://jobs.example.org/offre/123',
};

describe('cleanOffer', () => {
  it('cleans the text and fills unknown company and place with "?"', () => {
    expect(cleanOffer({ ...raw, company: ' ', location: null }, 'demo', 1200)).toEqual({
      source: 'demo',
      externalId: '123',
      title: 'Comptable (H/F/X)',
      company: '?',
      location: '?',
      postedAt: null,
      url: 'https://jobs.example.org/offre/123',
      salary: null,
      description: '',
      details: null,
    });
  });

  it('takes a job site written where the employer should be for an unknown employer', () => {
    expect(cleanOffer({ ...raw, company: 'StepStone Belgium' }, 'demo', 1200)?.company).toBe('?');
    expect(cleanOffer({ ...raw, company: 'Exemple SA' }, 'demo', 1200)?.company).toBe('Exemple SA');
  });

  it('caps the description at the configured length', () => {
    const offer = cleanOffer({ ...raw, description: 'mot '.repeat(1000) }, 'demo', 1200);
    expect(offer?.description.length).toBeLessThanOrEqual(1200);
    expect(offer?.description.endsWith('…')).toBe(true);
  });

  it('drops an offer without a title or with a link other than http or https', () => {
    expect(cleanOffer({ ...raw, title: ' \n ' }, 'demo', 1200)).toBeNull();
    expect(cleanOffer({ ...raw, url: 'javascript:alert(1)' }, 'demo', 1200)).toBeNull();
    expect(cleanOffer({ ...raw, url: '/relative/123' }, 'demo', 1200)).toBeNull();
    expect(cleanOffer({ ...raw, externalId: '' }, 'demo', 1200)).toBeNull();
    expect(cleanOffer({ ...raw, postedAt: '19/11/2026' }, 'demo', 1200)).toBeNull();
  });
});

describe('text helpers', () => {
  it('fold accents, ligatures and case', () => {
    expect(fold('  Œuvre  Élève\tDÉVELOPPEUR ')).toBe('oeuvre eleve developpeur');
    expect(stripAccents('Straße Ærø')).toBe('Strasse AEro');
  });

  it('drop invisible characters and keep words apart', () => {
    expect(cleanLine('a​b\r\nc\u0007d')).toBe('ab cd');
  });

  it('cut long text after a word, never inside a character', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('one two three four five', 15)).toBe('one two three…');
    const emoji = `${'a'.repeat(8)}😀😀`;
    expect(truncate(emoji, 10)).toBe(`${'a'.repeat(8)}…`);
  });
});
