import mammoth from 'mammoth';
import { type ArchiveLimits, ImportError } from './limits';
import { readZipEntries } from './zip';

// DOCX text with mammoth (raw text only: no HTML, no images, no external resource). Before
// mammoth opens the archive, every entry is decompressed once under the bounds, and the
// content types are checked again for macros.

const CONTENT_TYPES = '[Content_Types].xml';

export async function extractDocx(
  bytes: Buffer,
  limits: { archive: ArchiveLimits; maxExtractedChars: number },
): Promise<{ text: string }> {
  const entries = await readZipEntries(bytes, limits.archive, (name) => name === CONTENT_TYPES, {
    verifyAll: true,
  });
  const types = entries.get(CONTENT_TYPES)?.toString('utf8') ?? '';
  if (/macroEnabled|vbaProject/i.test(types)) throw new ImportError('file_macros');

  let raw: string;
  try {
    raw = (await mammoth.extractRawText({ buffer: bytes })).value;
  } catch {
    throw new ImportError('unsupported_file');
  }
  const text = raw
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > limits.maxExtractedChars) throw new ImportError('file_too_complex');
  if (text === '') throw new ImportError('no_text');
  return { text };
}
