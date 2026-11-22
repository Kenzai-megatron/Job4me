import type { ImportErrorCode } from '@job4me/contracts';

/** Bounds on archives (DOCX and LinkedIn ZIP), checked before any entry is read (ADR 0010). */
export interface ArchiveLimits {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxEntryUncompressedBytes: number;
  /** Largest uncompressed / compressed size of one entry... */
  maxCompressionRatio: number;
  /** ...for entries at least this large (small files compress oddly without being bombs). */
  minRatioCheckBytes: number;
}

/** Every bound of an extraction; the values live in config/default.yaml (imports). */
export interface ExtractLimits {
  archive: ArchiveLimits;
  maxPdfPages: number;
  maxExtractedChars: number;
  maxLinkedinRows: number;
}

/** A file refused or an extraction stopped, with the code the interface translates. */
export class ImportError extends Error {
  override name = 'ImportError';

  constructor(readonly code: ImportErrorCode) {
    super(code);
  }
}
