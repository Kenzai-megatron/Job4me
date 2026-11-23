import type { HistoryRow, ProposalRubric } from '@job4me/contracts';

// LinkedIn archive → proposals (plan, section 4, step 4): a fixed mapping of the allow-listed
// columns, without the AI. Every proposal names the file and the row it comes from.

type Row = Record<string, string>;

export interface LinkedinProposal {
  rubric: ProposalRubric;
  source: 'linkedin';
  content: Record<string, unknown>;
}

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
  janv: '01',
  févr: '02',
  mars: '03',
  avr: '04',
  mai: '05',
  juin: '06',
  juil: '07',
  août: '08',
  sept: '09',
  déc: '12',
};

/** "Mar 2022", "2022-03", "03/2022" → 2022-03; a year alone gives no month. */
export function linkedinMonth(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  let match = /^([a-zéû]+)\.?\s+(\d{4})$/u.exec(text);
  if (match) {
    const month = MONTHS[match[1]!.slice(0, 4)] ?? MONTHS[match[1]!.slice(0, 3)];
    return month ? `${match[2]}-${month}` : null;
  }
  match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  if (match) return `${match[1]}-${match[2]}`;
  match = /^(0?[1-9]|1[0-2])\/(\d{4})$/.exec(text);
  if (match) return `${match[2]}-${match[1]!.padStart(2, '0')}`;
  return null;
}

function linkedinYear(value: string | undefined): number | null {
  const match = /(19[5-9]\d|20\d{2}|2100)/.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

/** "11/3/26 10:00 AM" (month/day/year) or "2026-11-03" → 2026-11-03. */
export function linkedinDate(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(text);
  if (!us) return null;
  const year = us[3]!.length === 2 ? `20${us[3]}` : us[3]!;
  const month = Number(us[1]);
  const day = Number(us[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Language names as LinkedIn and Mehdi may write them → ISO 639-1. */
const LANGUAGES: Record<string, string> = {
  français: 'fr',
  francais: 'fr',
  french: 'fr',
  frans: 'fr',
  néerlandais: 'nl',
  neerlandais: 'nl',
  nederlands: 'nl',
  dutch: 'nl',
  flamand: 'nl',
  vlaams: 'nl',
  anglais: 'en',
  english: 'en',
  engels: 'en',
  allemand: 'de',
  deutsch: 'de',
  german: 'de',
  duits: 'de',
  espagnol: 'es',
  español: 'es',
  spanish: 'es',
  spaans: 'es',
  italien: 'it',
  italiano: 'it',
  italian: 'it',
  italiaans: 'it',
  portugais: 'pt',
  português: 'pt',
  portuguese: 'pt',
  arabe: 'ar',
  arabic: 'ar',
  العربية: 'ar',
  turc: 'tr',
  turkish: 'tr',
  türkçe: 'tr',
  polonais: 'pl',
  polish: 'pl',
  polski: 'pl',
  roumain: 'ro',
  romanian: 'ro',
  română: 'ro',
};

/** LinkedIn's proficiency scale → the CEFR level it usually means. */
const PROFICIENCY: [RegExp, string][] = [
  [/native|bilingual|maternelle|bilingue/i, 'C2'],
  [/full professional|professionnelle complète/i, 'C1'],
  [/professional working|professionnelle/i, 'B2'],
  [/limited working|limitée/i, 'B1'],
  [/elementary|notions|élémentaire/i, 'A2'],
];

function languageCode(name: string | undefined): string | null {
  return LANGUAGES[(name ?? '').trim().toLowerCase()] ?? null;
}

function proficiency(value: string | undefined): string | null {
  return PROFICIENCY.find(([pattern]) => pattern.test(value ?? ''))?.[1] ?? null;
}

const evidence = (file: string, ...parts: (string | undefined)[]) =>
  `${file} : ${parts.filter((part) => part && part.trim() !== '').join(' · ')}`;

const history = (rows: Row[], dateColumn: string): HistoryRow[] =>
  rows
    .filter((row) => row['Job Title'])
    .map((row) => ({
      title: row['Job Title']!,
      company: row['Company Name'] ?? null,
      url: row['Job Url'] ?? null,
      date: linkedinDate(row[dateColumn]),
    }));

export function proposalsFromLinkedin(files: Record<string, Row[]>): LinkedinProposal[] {
  const proposals: LinkedinProposal[] = [];
  const add = (rubric: ProposalRubric, content: Record<string, unknown>) =>
    proposals.push({ rubric, source: 'linkedin', content });

  const profile = files.profile?.[0];
  const fullName = [profile?.['First Name'], profile?.['Last Name']].filter(Boolean).join(' ');
  if (fullName) {
    add('identity', {
      field: 'fullName',
      value: fullName,
      evidence: evidence('Profile.csv', fullName),
    });
  }
  for (const row of files.positions ?? []) {
    if (!row.Title || !row['Company Name']) continue;
    const end = linkedinMonth(row['Finished On']);
    add('experiences', {
      title: row.Title,
      employer: row['Company Name'],
      location: row.Location ?? null,
      startMonth: linkedinMonth(row['Started On']),
      endMonth: end,
      current: !row['Finished On'],
      description: row.Description ?? null,
      evidence: evidence(
        'Positions.csv',
        row.Title,
        row['Company Name'],
        row['Started On'],
        row['Finished On'],
      ),
    });
  }
  for (const row of files.education ?? []) {
    if (!row['School Name']) continue;
    add('education', {
      degree: row['Degree Name'] ?? row.Notes ?? row['School Name'],
      institution: row['School Name'],
      year: linkedinYear(row['End Date']) ?? linkedinYear(row['Start Date']),
      evidence: evidence('Education.csv', row['Degree Name'], row['School Name'], row['End Date']),
    });
  }
  for (const row of files.skills ?? []) {
    if (row.Name)
      add('skills', { name: row.Name, level: null, evidence: evidence('Skills.csv', row.Name) });
  }
  for (const row of files.languages ?? []) {
    const language = languageCode(row.Name);
    if (!language) continue;
    add('languages', {
      language,
      overall: proficiency(row.Proficiency),
      evidence: evidence('Languages.csv', row.Name, row.Proficiency),
    });
  }
  for (const row of files.certifications ?? []) {
    if (!row.Name) continue;
    add('certifications', {
      name: row.Name,
      issuer: row.Authority ?? null,
      year: linkedinYear(row['Started On']),
      evidence: evidence('Certifications.csv', row.Name, row.Authority),
    });
  }
  const saved = history(files.savedJobs ?? [], 'Saved Date');
  if (saved.length > 0) {
    add('saved-offers', { rows: saved, evidence: evidence('Saved Jobs.csv', `${saved.length}`) });
  }
  const applied = history(files.jobApplications ?? [], 'Application Date');
  if (applied.length > 0) {
    add('past-applications', {
      rows: applied,
      evidence: evidence('Job Applications.csv', `${applied.length}`),
    });
  }
  return proposals;
}
