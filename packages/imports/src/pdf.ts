import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ImportError } from './limits';

// PDF text with pdf.js (legacy build for Node). Version 6 has no `eval` path left; fonts are not
// loaded, no system font is read, XFA forms, WebAssembly decoders and scripts stay off. Pages
// are never rendered, so the optional native canvas module is not installed (pnpm-workspace.yaml).

type PdfJs = typeof PdfJsModule;

let pdfjs: Promise<PdfJs> | undefined;

/** Loaded on first use: the API imports this package for detection only and never loads pdf.js. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

interface TextPiece {
  str?: unknown;
  hasEOL?: unknown;
}

function pageText(items: readonly TextPiece[]): string {
  let text = '';
  for (const item of items) {
    if (typeof item.str === 'string') text += item.str;
    if (item.hasEOL === true) text += '\n';
  }
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractPdf(
  bytes: Uint8Array,
  limits: { maxPdfPages: number; maxExtractedChars: number },
): Promise<{ text: string; pages: number }> {
  const { getDocument } = await loadPdfJs();
  const task = getDocument({
    // pdf.js may take ownership of the buffer it reads: give it a copy.
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    verbosity: 0,
  });
  let document: Awaited<typeof task.promise>;
  try {
    document = await task.promise;
  } catch (error) {
    await task.destroy();
    const name = error instanceof Error ? error.name : '';
    throw new ImportError(name === 'PasswordException' ? 'file_protected' : 'unsupported_file');
  }
  try {
    if (document.numPages > limits.maxPdfPages) throw new ImportError('file_too_complex');
    const pages: string[] = [];
    let characters = 0;
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = pageText(content.items as TextPiece[]);
      characters += text.length;
      if (characters > limits.maxExtractedChars) throw new ImportError('file_too_complex');
      pages.push(text);
      page.cleanup();
    }
    const text = pages.filter((page) => page !== '').join('\n\n');
    if (text === '') throw new ImportError('no_text');
    return { text, pages: document.numPages };
  } finally {
    // In pdf.js 6 the loading task owns the document and its fake worker.
    await task.destroy();
  }
}
