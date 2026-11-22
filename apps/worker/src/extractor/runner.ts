import { Worker } from 'node:worker_threads';
import {
  type ExtractedDocument,
  extractedDocumentSchema,
  type ImportErrorCode,
  importErrorCodes,
  type ImportKind,
  type ImportStats,
  importStatsSchema,
} from '@job4me/contracts';
import type { ExtractLimits } from '@job4me/imports/extract';

// Each file is read in its own thread (ADR 0010): a memory budget, a time budget, and nothing
// it prints reaches the logs. The thread's answer is checked like any untrusted input.

export type Outcome =
  | { ok: true; document: ExtractedDocument; stats: ImportStats }
  | { ok: false; code: ImportErrorCode };

export type Runner = (kind: ImportKind, bytes: Buffer) => Promise<Outcome>;

export interface ThreadOptions {
  limits: ExtractLimits;
  timeoutMs: number;
  memoryMb: number;
}

// Bundled: dist/extract-thread.js next to dist/extractor.js. From the sources: thread.ts.
const fromSources = import.meta.url.endsWith('.ts');
const THREAD_URL = new URL(fromSources ? './thread.ts' : './extract-thread.js', import.meta.url);

/** Sources run under tsx in development; tests start plain Node, which needs tsx for the thread. */
function threadExecArgv(): string[] | undefined {
  if (!fromSources || process.execArgv.some((arg) => arg.includes('tsx'))) return undefined;
  return ['--import', 'tsx'];
}

/** Checks the thread's answer: a known shape, within the bounds, or a known error code. */
export function checkOutcome(message: unknown, limits: ExtractLimits): Outcome {
  const failed = (code: ImportErrorCode): Outcome => ({ ok: false, code });
  if (typeof message !== 'object' || message === null) return failed('extraction_failed');
  const answer = message as { ok?: unknown; code?: unknown; document?: unknown; stats?: unknown };
  if (answer.ok === false) {
    const code = importErrorCodes.find((known) => known === answer.code);
    return failed(code ?? 'extraction_failed');
  }
  const document = extractedDocumentSchema.safeParse(answer.document);
  const stats = importStatsSchema.safeParse(answer.stats);
  if (answer.ok !== true || !document.success || !stats.success) return failed('extraction_failed');
  if (document.data.kind === 'text' && document.data.text.length > limits.maxExtractedChars) {
    return failed('file_too_complex');
  }
  if (document.data.kind === 'linkedin') {
    const rows = Object.values(document.data.files).reduce((sum, list) => sum + list.length, 0);
    if (rows > limits.maxLinkedinRows * Object.keys(document.data.files).length) {
      return failed('file_too_complex');
    }
  }
  return { ok: true, document: document.data, stats: stats.data };
}

export function threadRunner(options: ThreadOptions): Runner {
  const execArgv = threadExecArgv();
  return (kind, bytes) =>
    new Promise<Outcome>((resolve) => {
      const worker = new Worker(THREAD_URL, {
        workerData: { kind, limits: options.limits },
        ...(execArgv ? { execArgv } : {}),
        // No environment (paths of secret files included) and no shared output.
        env: {},
        stdout: true,
        stderr: true,
        resourceLimits: {
          maxOldGenerationSizeMb: options.memoryMb,
          maxYoungGenerationSizeMb: Math.max(8, Math.round(options.memoryMb / 8)),
          stackSizeMb: 4,
        },
      });
      worker.stdout.resume();
      worker.stderr.resume();

      let settled = false;
      const finish = (outcome: Outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        resolve(outcome);
      };
      const timer = setTimeout(
        () => finish({ ok: false, code: 'extraction_timeout' }),
        options.timeoutMs,
      );
      worker.once('message', (message: unknown) => finish(checkOutcome(message, options.limits)));
      worker.once('error', (error: NodeJS.ErrnoException) =>
        finish({
          ok: false,
          code:
            error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'file_too_complex' : 'extraction_failed',
        }),
      );
      worker.once('exit', () => finish({ ok: false, code: 'extraction_failed' }));

      // A copy the thread owns: the decrypted file never stays shared between the two.
      const copy = new Uint8Array(bytes);
      worker.postMessage(copy, [copy.buffer]);
    });
}
