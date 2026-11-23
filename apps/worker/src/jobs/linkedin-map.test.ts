import { loadConfig } from '@job4me/config';
import { extractImport } from '@job4me/imports/extract';
import { makeLinkedinArchive, THIRD_PARTY_NAMES } from '@job4me/imports/testing';
import { describe, expect, it } from 'vitest';
import { linkedinDate, linkedinMonth, proposalsFromLinkedin } from './linkedin-map';

describe('LinkedIn dates', () => {
  it('reads the formats of the export', () => {
    expect(linkedinMonth('Mar 2022')).toBe('2022-03');
    expect(linkedinMonth('sept. 2021')).toBe('2021-09');
    expect(linkedinMonth('2020-11')).toBe('2020-11');
    expect(linkedinMonth('2019')).toBeNull();
    expect(linkedinMonth(undefined)).toBeNull();
    expect(linkedinDate('11/3/26 10:00 AM')).toBe('2026-11-03');
    expect(linkedinDate('2026-01-15 08:00')).toBe('2026-01-15');
    expect(linkedinDate('13/40/26')).toBeNull();
  });
});

describe('LinkedIn archive → proposals', () => {
  it('maps the allow-listed files to profile proposals, without the AI', async () => {
    process.env.JOB4ME_ENV ??= 'test';
    const { document } = await extractImport(
      'linkedin_zip',
      makeLinkedinArchive(),
      loadConfig().settings.imports,
    );
    if (document.kind !== 'linkedin') throw new Error('expected LinkedIn rows');
    const proposals = proposalsFromLinkedin(document.files);
    const rubrics = proposals.map((proposal) => proposal.rubric);
    expect(rubrics).toEqual([
      'identity',
      'experiences',
      'experiences',
      'skills',
      'skills',
      'skills',
      'languages',
      'languages',
      'saved-offers',
      'past-applications',
    ]);
    expect(proposals[1]!.content).toMatchObject({
      title: 'Analyste de données',
      employer: 'Exemple SA',
      startMonth: '2022-03',
      endMonth: null,
      current: true,
    });
    expect(proposals[2]!.content).toMatchObject({
      startMonth: '2021-09',
      endMonth: '2022-02',
      current: false,
    });
    expect(proposals[6]!.content).toMatchObject({ language: 'fr', overall: 'C2' });
    expect(proposals[7]!.content).toMatchObject({ language: 'nl', overall: 'B2' });
    expect(proposals[9]!.content.rows).toEqual([
      {
        title: 'Analyste BI',
        company: 'Démo SPRL',
        url: 'https://www.linkedin.com/jobs/view/2',
        date: '2026-11-02',
      },
    ]);
    expect(proposals.every((proposal) => proposal.source === 'linkedin')).toBe(true);
    const all = JSON.stringify(proposals);
    for (const name of THIRD_PARTY_NAMES) expect(all).not.toContain(name);
    expect(all).not.toContain('alex@example.org');
  });
});
