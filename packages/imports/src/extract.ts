import type { ExtractedDocument, ImportKind, ImportStats } from '@job4me/contracts';
import { detectImport } from './detect';
import { extractDocx } from './docx';
import { type ExtractLimits, ImportError } from './limits';
import { extractLinkedin } from './linkedin';
import { extractPdf } from './pdf';

// `@job4me/imports/extract`: the document readers, for the isolated extractor only (ADR 0010).

export { ImportError, type ExtractLimits } from './limits';
export { extractedAad, storagePath, uploadAad } from './storage';

export interface Extraction {
  document: ExtractedDocument;
  stats: ImportStats;
}

/** Reads a file whose kind was detected at upload; the kind is checked again first. */
export async function extractImport(
  kind: ImportKind,
  bytes: Buffer,
  limits: ExtractLimits,
): Promise<Extraction> {
  if ((await detectImport(bytes, limits.archive)) !== kind) {
    throw new ImportError('unsupported_file');
  }
  switch (kind) {
    case 'cv_pdf': {
      const { text, pages } = await extractPdf(bytes, limits);
      return {
        document: { kind: 'text', text, pages },
        stats: { pages, characters: text.length },
      };
    }
    case 'cv_docx': {
      const { text } = await extractDocx(bytes, limits);
      return {
        document: { kind: 'text', text, pages: null },
        stats: { characters: text.length },
      };
    }
    case 'linkedin_zip': {
      const { files, rows } = await extractLinkedin(bytes, limits);
      return { document: { kind: 'linkedin', files }, stats: { rows } };
    }
  }
}
