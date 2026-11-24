import { describe, expect, it } from 'vitest';
import {
  type Comparable,
  employerWords,
  identify,
  type IncomingPosting,
  isJobSite,
  mergeReason,
  placePostings,
  sameEmployer,
  type StoredPosting,
} from './dedup';

// The cases measured in docs/SOURCES.md, section 1.6, with invented offers.

const posting = (
  title: string,
  company: string,
  source = 'actiris',
  url: string | null = null,
): Comparable => ({ source, url, identity: identify(title, company) });

describe('identify', () => {
  it('drops gender marks, also mistyped', () => {
    for (const title of [
      'Business Analyst (m/f/x)',
      'Business Analyst H/F/X',
      'Business analyst (M/V/X)',
      'Business Analyst - M/W/D',
      'BUSINESS ANALYST (m/f/x',
      'Business Analyst m/f/x)',
      'Business Analyst (H/F)',
      'Business Analyst (mfx)',
      'Business Analyst (homme/femme)',
    ]) {
      expect(identify(title, 'Exemple').title).toBe('business analyst');
    }
    // Two letters in a code are not a gender mark.
    expect(identify('Engineer MV/HV', 'Exemple').title).toBe('engineer mv hv');
  });

  it('drops the employer when it opens or closes the title', () => {
    expect(
      identify('AG Insurance - Business Process Analyst - Brussels', 'AG Insurance').title,
    ).toBe('business process analyst');
    expect(identify('Business Analyst | Exemple SA', 'Exemple').title).toBe('business analyst');
    expect(identify('Comptable (Exemple)', 'Exemple SRL').title).toBe('comptable');
    expect(identify('Comptable chez Exemple', 'Exemple').title).toBe('comptable');
    expect(identify('Sander - Accountant', 'Sander Brussels').title).toBe('accountant');
    // Never the only words of the title, nor an employer that only shares a word.
    expect(identify('Data Analyst', 'Data').title).toBe('data analyst');
    expect(identify('Business Analyst - Brussels', 'Business Solutions').title).toBe(
      'business analyst',
    );
  });

  it('drops references, places, contract words and punctuation', () => {
    expect(identify('Comptable (Réf. 12345) - Bruxelles - CDI', 'Exemple').title).toBe('comptable');
    expect(identify('Boekhouder - Job ID: R0012345 - Gent, Belgium', 'Exemple').title).toBe(
      'boekhouder',
    );
    expect(identify('Vacature 88123: Boekhouder (m/v) voltijds', 'Exemple').title).toBe(
      'boekhouder',
    );
    expect(identify('Analyste & Développeur – full-time', 'Exemple').title).toBe(
      'analyste developpeur',
    );
    expect(identify('Employé administratif temps plein - Louvain-la-Neuve', 'Exemple').title).toBe(
      'employe administratif',
    );
  });

  it('keeps a title made only of removed words', () => {
    expect(identify('Bruxelles', 'Exemple').title).toBe('bruxelles');
  });

  it('reads references: four figures or more, never a year, an amount or a postal code', () => {
    expect(identify('Comptable - Job ID 12345', 'Exemple').refs).toEqual(['12345']);
    expect(identify('Comptable R0012345', 'Exemple').refs).toEqual(['0012345']);
    expect(identify('Comptable (réf. 2041)', 'Exemple').refs).toEqual(['2041']);
    expect(identify('Stage 2026 - comptable', 'Exemple').refs).toEqual([]);
    expect(identify('Comptable 4700 EUR', 'Exemple').refs).toEqual([]);
    expect(identify('Comptable 45000€ brut', 'Exemple').refs).toEqual([]);
    expect(identify('Comptable - 1000 Bruxelles', 'Exemple').refs).toEqual([]);
  });

  it('gives the same key to the same offer written differently', () => {
    const a = identify('Comptable (H/F/X) - Bruxelles', 'Exemple SA');
    const b = identify('COMPTABLE m/f/x', 'Exemple');
    const c = identify('Comptable - Réf. 77812', 'Exemple Group');
    expect(a.key).toMatch(/^[0-9a-f]{16}$/);
    expect(b.key).toBe(a.key);
    expect(c.key).toBe(a.key);
    expect(identify('Comptable', 'Autre').key).not.toBe(a.key);
    expect(identify('Comptable senior', 'Exemple').key).not.toBe(a.key);
  });

  it('gives a bare title without figures', () => {
    expect(identify('Technicien niveau 2', 'Exemple').bare).toBe('technicien niveau');
    expect(identify('12345', 'Exemple').bare).toBe('');
  });
});

describe('employers', () => {
  it('drop legal forms and the country', () => {
    expect(employerWords('Sander Group BV')).toEqual(['sander']);
    expect(employerWords('Exemple Belgium SA')).toEqual(['exemple']);
    expect(employerWords('?')).toEqual([]);
  });

  it('take a job site for an unknown employer', () => {
    for (const site of ['LinkedIn', 'JOBAT', 'Indeed', 'StepStone', 'StepStone Belgium']) {
      expect(isJobSite(site)).toBe(true);
      expect(employerWords(site)).toEqual([]);
    }
    expect(isJobSite('LinkedIn Ireland')).toBe(false);
    expect(isJobSite('Exemple')).toBe(false);
  });

  it('are the same up to a name extension, compared by words', () => {
    const same = (a: string, b: string) => sameEmployer(employerWords(a), employerWords(b));
    expect(same('Wibit Consulting & Services', 'Wibit Consulting & Services (WibitCS)')).toBe(true);
    expect(same('Client of Manpower', 'Manpower')).toBe(true);
    expect(same('Sander', 'Sander Brussels')).toBe(true);
    expect(same('Adecco', 'Adeccorp')).toBe(false);
    expect(same('Deloitte', 'BNP Paribas Fortis')).toBe(false);
    expect(same('Client of Manpower', 'Client of Randstad')).toBe(false);
  });
});

describe('mergeReason', () => {
  it('never merges two named employers that differ without a common reference', () => {
    const deloitte = posting('Business Analyst', 'Deloitte');
    const bnp = posting('Business Analyst', 'BNP Paribas Fortis', 'stepstone');
    expect(mergeReason(deloitte, bnp, 'batch')).toBeNull();
    expect(mergeReason(deloitte, bnp, 'history')).toBeNull();
    expect(
      mergeReason(
        posting('Business Analyst', 'Adecco'),
        posting('Business Analyst', 'Adeccorp'),
        'batch',
      ),
    ).toBeNull();
  });

  it('merges on the content key', () => {
    expect(
      mergeReason(
        posting('Comptable (m/f/x) - Bruxelles', 'Exemple SA'),
        posting('Comptable', 'Exemple', 'forem'),
        'history',
      ),
    ).toBe('key');
  });

  it('merges on a common reference, even when the employers differ', () => {
    expect(
      mergeReason(
        posting('Comptable - Job ID 12345', 'Client of Manpower'),
        posting('Comptable (12345)', 'Exemple', 'jobrapido'),
        'history',
      ),
    ).toBe('reference');
  });

  it('keeps apart two postings whose references all differ', () => {
    expect(
      mergeReason(
        posting('Business Analyst - Job ID 12345', 'Exemple'),
        posting('Business Analyst - Job ID 67890', 'Exemple', 'stepstone'),
        'batch',
      ),
    ).toBeNull();
  });

  it('merges the same employer up to an extension: in a run, or from another source', () => {
    const sander = posting('Accountant', 'Sander', 'jobrapido');
    const brussels = posting('Accountant', 'Sander Brussels', 'jobrapido');
    expect(mergeReason(sander, brussels, 'batch')).toBe('employer');
    expect(mergeReason(sander, brussels, 'history')).toBeNull();
    expect(mergeReason(sander, posting('Accountant', 'Sander Brussels', 'talent'), 'history')).toBe(
      'employer',
    );
  });

  it('merges one posting without an employer in a run only', () => {
    const named = posting('Comptable 2 jours', 'Exemple', 'jobrapido');
    const unknown = posting('Comptable 3 jours', 'LinkedIn', 'jobrapido');
    expect(mergeReason(named, unknown, 'batch')).toBe('no_employer');
    expect(mergeReason(named, unknown, 'history')).toBeNull();
    expect(
      mergeReason(posting('Comptable 2', '?'), posting('Comptable 3', '?'), 'batch'),
    ).toBeNull();
  });

  it('merges on the same link at the same bare title only', () => {
    const url = 'https://example.org/offres/1';
    expect(
      mergeReason(
        posting('Comptable 2 jours', '?', 'google_jobs', url),
        posting('Comptable 3 jours', 'Exemple', 'stepstone', url),
        'history',
      ),
    ).toBe('url');
    // A shared careers page does not make two offers one.
    expect(
      mergeReason(
        posting('Comptable', 'Exemple', 'google_jobs', url),
        posting('Juriste', 'Exemple', 'stepstone', url),
        'history',
      ),
    ).toBeNull();
  });
});

const incoming = (
  title: string,
  company: string,
  extra: Partial<IncomingPosting> = {},
): IncomingPosting => ({
  ...posting(title, company, extra.source ?? 'jobrapido'),
  known: null,
  ...extra,
});

const stored = (
  title: string,
  company: string,
  offerId: string,
  extra: Partial<StoredPosting> = {},
): StoredPosting => ({
  ...posting(title, company, extra.source ?? 'actiris'),
  postingId: `posting-${offerId}`,
  offerId,
  seenAt: new Date('2026-11-20T07:10:00Z'),
  ...extra,
});

describe('placePostings', () => {
  it('keeps known postings where they are, even if they now match another announcement', () => {
    const placements = placePostings(
      [incoming('Comptable', 'Exemple', { known: { postingId: 'p1', offerId: 'o1' } })],
      [stored('Comptable', 'Exemple', 'o2')],
    );
    expect(placements).toEqual([{ kind: 'known', offerId: 'o1' }]);
  });

  it('groups a run, joins stored announcements and counts the rest as new', () => {
    const placements = placePostings(
      [
        incoming('Accountant', 'Sander'),
        incoming('Accountant', 'Sander Brussels'),
        incoming('Comptable (m/f/x)', 'Exemple'),
        incoming('Business Analyst', 'BNP Paribas Fortis'),
      ],
      [
        stored('Comptable - Bruxelles', 'Exemple SA', 'o1'),
        stored('Business Analyst', 'Deloitte', 'o2'),
      ],
    );
    expect(placements).toEqual([
      { kind: 'new' },
      { kind: 'grouped', leader: 0, reason: 'employer' },
      { kind: 'joined', offerId: 'o1', reason: 'key' },
      { kind: 'new' },
    ]);
  });

  it('follows a posting that joined a stored announcement', () => {
    const placements = placePostings(
      [incoming('Comptable', 'Exemple'), incoming('Comptable 3', '?')],
      [stored('Comptable', 'Exemple', 'o1')],
    );
    expect(placements[1]).toEqual({ kind: 'joined', offerId: 'o1', reason: 'no_employer' });
  });

  it('prefers the strongest reason, then the freshest announcement', () => {
    const placements = placePostings(
      [incoming('Comptable - Job ID 12345', 'Exemple', { source: 'stepstone' })],
      [
        stored('Comptable', 'Exemple Brussels', 'old', { seenAt: new Date('2026-11-01') }),
        stored('Comptable', 'Exemple Brussels', 'fresh', { seenAt: new Date('2026-11-20') }),
        stored('Comptable 12345', 'Autre', 'ref'),
      ],
    );
    expect(placements).toEqual([{ kind: 'joined', offerId: 'ref', reason: 'reference' }]);
    expect(
      placePostings(
        [incoming('Comptable', 'Exemple', { source: 'stepstone' })],
        [
          stored('Comptable', 'Exemple Brussels', 'old', { seenAt: new Date('2026-11-01') }),
          stored('Comptable', 'Exemple Brussels', 'fresh', { seenAt: new Date('2026-11-20') }),
        ],
      ),
    ).toEqual([{ kind: 'joined', offerId: 'fresh', reason: 'employer' }]);
  });

  it('applies the history rules to a run when regrouping stored postings', () => {
    const placements = placePostings(
      [incoming('Accountant', 'Sander'), incoming('Accountant', 'Sander Brussels')],
      [],
      'history',
    );
    expect(placements).toEqual([{ kind: 'new' }, { kind: 'new' }]);
  });
});
