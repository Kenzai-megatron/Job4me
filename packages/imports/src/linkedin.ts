import { parse } from 'csv-parse/sync';
import { type ArchiveLimits, ImportError } from './limits';
import { LINKEDIN_FILES, type LinkedinFileKey, linkedinFileKey } from './linkedin-files';
import { readZipEntries } from './zip';

// LinkedIn archive: the allow-listed CSV files only, and only their allow-listed columns.

type Row = Record<string, string>;

/** Some exports put a few lines of notes above the header: the header is the first known row. */
const HEADER_SEARCH_ROWS = 5;

function rowsOf(
  csv: Buffer,
  columns: readonly string[],
  maxRows: number,
): { rows: Row[]; tooMany: boolean } {
  let records: string[][];
  try {
    records = parse(csv, {
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      to: maxRows + HEADER_SEARCH_ROWS + 1,
    });
  } catch {
    throw new ImportError('unsupported_file');
  }
  const wanted = new Map(columns.map((column) => [column.toLowerCase(), column]));
  const headerIndex = records
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((record) => record.some((cell) => wanted.has(cell.trim().toLowerCase())));
  if (headerIndex === -1) return { rows: [], tooMany: false };
  const header = records[headerIndex]!.map((cell) => wanted.get(cell.trim().toLowerCase()));
  const body = records.slice(headerIndex + 1);
  const rows: Row[] = [];
  for (const record of body.slice(0, maxRows)) {
    const row: Row = {};
    header.forEach((column, index) => {
      const value = record[index]?.trim();
      if (column && value) row[column] = value;
    });
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return { rows, tooMany: body.length > maxRows };
}

export async function extractLinkedin(
  bytes: Buffer,
  limits: { archive: ArchiveLimits; maxLinkedinRows: number },
): Promise<{ files: Partial<Record<LinkedinFileKey, Row[]>>; rows: Record<string, number> }> {
  const entries = await readZipEntries(
    bytes,
    limits.archive,
    (name) => linkedinFileKey(name) !== null,
  );
  const files: Partial<Record<LinkedinFileKey, Row[]>> = {};
  for (const [name, content] of entries) {
    const key = linkedinFileKey(name);
    if (!key) continue;
    const { rows, tooMany } = rowsOf(content, LINKEDIN_FILES[key].columns, limits.maxLinkedinRows);
    if (tooMany) throw new ImportError('file_too_complex');
    // Job applications may come split in several files: they add up.
    const merged = [...(files[key] ?? []), ...rows];
    if (merged.length > limits.maxLinkedinRows) throw new ImportError('file_too_complex');
    files[key] = merged;
  }
  const rows = Object.fromEntries(Object.entries(files).map(([key, list]) => [key, list.length]));
  if (Object.values(rows).every((count) => count === 0)) throw new ImportError('no_text');
  return { files, rows };
}
