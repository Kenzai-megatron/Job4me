import { parentPort, workerData } from 'node:worker_threads';
import type { ImportKind } from '@job4me/contracts';
import { type ExtractLimits, extractImport, ImportError } from '@job4me/imports/extract';

// Thread entry (bundled as extract-thread.js): reads one file, answers once, then is terminated.

const { kind, limits } = workerData as { kind: ImportKind; limits: ExtractLimits };
const port = parentPort;
if (!port) throw new Error('the extraction thread must run as a worker thread');

port.once('message', (bytes: Uint8Array) => {
  const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  extractImport(kind, file, limits).then(
    ({ document, stats }) => port.postMessage({ ok: true, document, stats }),
    (error: unknown) =>
      port.postMessage({
        ok: false,
        code: error instanceof ImportError ? error.code : 'extraction_failed',
      }),
  );
});
