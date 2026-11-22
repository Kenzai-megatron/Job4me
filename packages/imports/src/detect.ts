import type { ImportKind } from '@job4me/contracts';
import { type ArchiveLimits, ImportError } from './limits';
import { linkedinFileKey } from './linkedin-files';
import { inspectZip } from './zip';

// The real type of a file comes from its first bytes and, for archives, from the names in their
// central directory: never from the file name or the type the browser announces.

const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1');
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MACRO_PARTS = /(^|\/)(vbaproject\.bin|vbadata\.xml)$/i;

export const IMPORT_MEDIA_TYPES: Record<ImportKind, string> = {
  cv_pdf: 'application/pdf',
  cv_docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  linkedin_zip: 'application/zip',
};

/** Detects a CV (PDF, DOCX without macros) or a LinkedIn archive; refuses anything else. */
export async function detectImport(buffer: Buffer, limits: ArchiveLimits): Promise<ImportKind> {
  if (buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) return 'cv_pdf';
  if (!buffer.subarray(0, ZIP_SIGNATURE.length).equals(ZIP_SIGNATURE)) {
    throw new ImportError('unsupported_file');
  }
  const entries = await inspectZip(buffer, limits);
  const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
  if (names.has('word/document.xml')) {
    if (!names.has('[content_types].xml')) throw new ImportError('unsupported_file');
    if (entries.some((entry) => MACRO_PARTS.test(entry.name))) {
      throw new ImportError('file_macros');
    }
    return 'cv_docx';
  }
  if (entries.some((entry) => linkedinFileKey(entry.name) !== null)) return 'linkedin_zip';
  throw new ImportError('unsupported_file');
}
