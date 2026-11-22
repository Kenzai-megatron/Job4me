import { join } from 'node:path';
import { aadFor } from '@job4me/security';

// Where an imported file lives and what its ciphertexts are bound to (ADR 0010). The API writes
// the file, the extractor reads it: both use these helpers so the formats cannot drift apart.

export const IMPORTS_DIR = 'imports';

/** 32 random bytes in base64url: the only file names the imports directory ever holds. */
export const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The encrypted file of an upload is bound to that upload's row. */
export const uploadAad = (uploadId: string) => aadFor('upload', 'file', uploadId);

/** The extracted text or rows are bound to their import run. */
export const extractedAad = (importRunId: string) => aadFor('import_run', 'extracted', importRunId);

/** Path of a stored file; refuses any name that is not a storage key (no path from the database). */
export function storagePath(filesDir: string, storageKey: string): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) throw new Error('invalid storage key');
  return join(filesDir, IMPORTS_DIR, storageKey);
}
