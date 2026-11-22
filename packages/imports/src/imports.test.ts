import { describe, expect, it } from 'vitest';
import { detectImport, type ExtractLimits, ImportError, inspectZip } from './index';
import { extractImport } from './extract';
import {
  makeDocx,
  makeLinkedinArchive,
  makePdf,
  makeZip,
  makeZipBomb,
  patchCentralDirectory,
  THIRD_PARTY_NAMES,
} from './testing';

const limits: ExtractLimits = {
  archive: {
    maxEntries: 50,
    maxTotalUncompressedBytes: 20 * 1024 * 1024,
    maxEntryUncompressedBytes: 10 * 1024 * 1024,
    maxCompressionRatio: 100,
    minRatioCheckBytes: 1024 * 1024,
  },
  maxPdfPages: 3,
  maxExtractedChars: 5000,
  maxLinkedinRows: 100,
};

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ImportError) return error.code;
    throw error;
  }
  return 'no error';
}

const cv = [
  ['Alex Exemple', 'Analyste de données à Bruxelles'],
  ['Expérience', 'Exemple SA (2022 – aujourd’hui) : rapports mensuels'],
];

describe('real type detection', () => {
  it('recognises a PDF, a DOCX and a LinkedIn archive from their content', async () => {
    expect(await detectImport(makePdf(cv), limits.archive)).toBe('cv_pdf');
    expect(await detectImport(makeDocx(['Bonjour']), limits.archive)).toBe('cv_docx');
    expect(await detectImport(makeLinkedinArchive(), limits.archive)).toBe('linkedin_zip');
  });

  it('refuses other files, whatever their name', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await codeOf(detectImport(png, limits.archive))).toBe('unsupported_file');
    expect(await codeOf(detectImport(Buffer.from('<html>%PDF-'), limits.archive))).toBe(
      'unsupported_file',
    );
    const odt = makeZip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '' });
    expect(await codeOf(detectImport(odt, limits.archive))).toBe('unsupported_file');
    const truncated = makeDocx(['Bonjour']).subarray(0, 60);
    expect(await codeOf(detectImport(truncated, limits.archive))).toBe('unsupported_file');
  });

  it('refuses documents with macros', async () => {
    expect(await codeOf(detectImport(makeDocx(['x'], { vbaProject: true }), limits.archive))).toBe(
      'file_macros',
    );
  });

  it('refuses encrypted archives', async () => {
    const encrypted = patchCentralDirectory(makeDocx(['x']), ({ flags }) => ({ flags: flags | 1 }));
    expect(await codeOf(detectImport(encrypted, limits.archive))).toBe('file_protected');
  });
});

describe('archive bounds', () => {
  it('refuses a ZIP bomb from its central directory, before inflating anything', async () => {
    expect(await codeOf(inspectZip(makeZipBomb(30), limits.archive))).toBe('file_too_complex');
  });

  it('refuses too many entries', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`Skills-${index}.txt`, 'x']),
    );
    expect(await codeOf(inspectZip(makeZip(files), limits.archive))).toBe('file_too_complex');
  });

  it('refuses an entry that inflates beyond the size its headers declare', async () => {
    const big = makeZip({
      'Positions.csv': `Company Name,Title\n${'Exemple SA,Analyste\n'.repeat(120_000)}`,
    });
    const lying = patchCentralDirectory(big, () => ({ uncompressedSize: 1000 }));
    expect(await codeOf(extractImport('linkedin_zip', lying, limits))).toBe('file_too_complex');
  });
});

describe('PDF', () => {
  it('extracts the text of every page', async () => {
    const { document, stats } = await extractImport('cv_pdf', makePdf(cv), limits);
    expect(document.kind).toBe('text');
    if (document.kind !== 'text') return;
    expect(document.text).toContain('Alex Exemple');
    expect(document.text).toContain('Analyste de données à Bruxelles');
    expect(document.text).toContain('Exemple SA');
    expect(stats).toEqual({ pages: 2, characters: document.text.length });
  });

  it('refuses a password-protected PDF with its own code', async () => {
    expect(await codeOf(extractImport('cv_pdf', makePdf(cv, { encrypted: true }), limits))).toBe(
      'file_protected',
    );
  });

  it('stops at the page and character bounds', async () => {
    const long = makePdf([['1'], ['2'], ['3'], ['4']]);
    expect(await codeOf(extractImport('cv_pdf', long, limits))).toBe('file_too_complex');
    // pdf.js leaves out text drawn beyond the page: 40 lines of 60 characters fit on it.
    const verbose = makePdf([Array.from({ length: 40 }, () => 'x'.repeat(60))]);
    const short = { ...limits, maxExtractedChars: 1000 };
    expect(await codeOf(extractImport('cv_pdf', verbose, short))).toBe('file_too_complex');
  });

  it('reports a PDF without text (a scan)', async () => {
    expect(await codeOf(extractImport('cv_pdf', makePdf([[]]), limits))).toBe('no_text');
  });
});

describe('DOCX', () => {
  it('extracts the raw text', async () => {
    const { document } = await extractImport(
      'cv_docx',
      makeDocx(['Alex Exemple', 'SQL, Power BI & Python']),
      limits,
    );
    expect(document).toEqual({
      kind: 'text',
      text: 'Alex Exemple\n\nSQL, Power BI & Python',
      pages: null,
    });
  });

  it('refuses a macro-enabled content type even without the VBA part', async () => {
    const docm = makeDocx(['x'], { macroContentType: true });
    expect(await codeOf(extractImport('cv_docx', docm, limits))).toBe('file_macros');
  });

  it('checks the kind detected at upload again', async () => {
    expect(await codeOf(extractImport('cv_docx', makePdf(cv), limits))).toBe('unsupported_file');
  });
});

describe('LinkedIn archive', () => {
  it('reads the allow-listed files and columns only', async () => {
    const { document, stats } = await extractImport('linkedin_zip', makeLinkedinArchive(), limits);
    if (document.kind !== 'linkedin') throw new Error('expected LinkedIn rows');
    expect(Object.keys(document.files).sort()).toEqual([
      'jobApplications',
      'languages',
      'positions',
      'profile',
      'savedJobs',
      'skills',
    ]);
    expect(document.files.positions?.[1]).toEqual({
      'Company Name': 'Démo SPRL',
      Title: 'Stagiaire',
      Description: 'Tableaux de bord, Excel',
      Location: 'Liège',
      'Started On': 'Sep 2021',
      'Finished On': 'Feb 2022',
    });
    expect(document.files.profile?.[0]).not.toHaveProperty('Address');
    expect(document.files.profile?.[0]).not.toHaveProperty('Birth Date');
    expect(document.files.jobApplications?.[0]).toEqual({
      'Application Date': '11/2/26 9:00 AM',
      'Company Name': 'Démo SPRL',
      'Job Title': 'Analyste BI',
      'Job Url': 'https://www.linkedin.com/jobs/view/2',
    });
    expect(stats.rows).toMatchObject({ positions: 2, skills: 3, languages: 2 });
    const all = JSON.stringify(document);
    for (const name of [...THIRD_PARTY_NAMES, 'Tierce', 'example.org']) {
      expect(all).not.toContain(name);
    }
  });

  it('stops at the row bound', async () => {
    const skills = `Name\n${Array.from({ length: 101 }, (_, index) => `Skill ${index}`).join('\n')}\n`;
    const archive = makeZip({ 'Skills.csv': skills });
    expect(await codeOf(extractImport('linkedin_zip', archive, limits))).toBe('file_too_complex');
  });
});
