// LinkedIn archive ("Get a copy of your data"): only these CSV files are ever opened, and only
// these columns are kept (plan, section 4). Connections, messages, invitations, endorsements and
// every other file hold data about other people and are never read.
// Names follow LinkedIn's export format; they will be checked against Mehdi's real archive.

export interface LinkedinFile {
  /** File names, compared without case and without the folder (`Jobs/Saved Jobs.csv`). */
  names: RegExp;
  columns: readonly string[];
}

export const LINKEDIN_FILES = {
  profile: {
    names: /^profile\.csv$/i,
    columns: [
      'First Name',
      'Last Name',
      'Headline',
      'Summary',
      'Industry',
      'Zip Code',
      'Geo Location',
    ],
  },
  positions: {
    names: /^positions\.csv$/i,
    columns: ['Company Name', 'Title', 'Description', 'Location', 'Started On', 'Finished On'],
  },
  education: {
    names: /^education\.csv$/i,
    columns: ['School Name', 'Start Date', 'End Date', 'Notes', 'Degree Name', 'Activities'],
  },
  skills: { names: /^skills\.csv$/i, columns: ['Name'] },
  languages: { names: /^languages\.csv$/i, columns: ['Name', 'Proficiency'] },
  certifications: {
    names: /^certifications\.csv$/i,
    columns: ['Name', 'Url', 'Authority', 'Started On', 'Finished On'],
  },
  savedJobs: {
    names: /^saved jobs\.csv$/i,
    columns: ['Saved Date', 'Job Url', 'Job Title', 'Company Name'],
  },
  jobApplications: {
    // Contact e-mail, phone number, résumé name and answers are left out on purpose.
    names: /^job applications(_\d+)?\.csv$/i,
    columns: ['Application Date', 'Company Name', 'Job Title', 'Job Url'],
  },
} as const satisfies Record<string, LinkedinFile>;

export type LinkedinFileKey = keyof typeof LINKEDIN_FILES;

/** The allow-listed file an archive entry is, or null for any other entry. */
export function linkedinFileKey(entryName: string): LinkedinFileKey | null {
  if (entryName.endsWith('/') || entryName.split('/').includes('..')) return null;
  const base = entryName.slice(entryName.lastIndexOf('/') + 1);
  for (const [key, file] of Object.entries(LINKEDIN_FILES)) {
    if (file.names.test(base)) return key as LinkedinFileKey;
  }
  return null;
}
