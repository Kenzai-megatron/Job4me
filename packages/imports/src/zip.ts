import type { Readable } from 'node:stream';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { type ArchiveLimits, ImportError } from './limits';

// Archives are read with yauzl (central directory first, then one entry at a time), entirely in
// memory: nothing is ever written to disk, so entry names cannot escape a directory.

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

async function open(buffer: Buffer): Promise<ZipFile> {
  try {
    return await yauzl.fromBufferPromise(buffer, {
      lazyEntries: true,
      decodeStrings: true,
      // Refuses an entry whose real size differs from the size its headers declare.
      validateEntrySizes: true,
      strictFileNames: true,
    });
  } catch {
    throw new ImportError('unsupported_file');
  }
}

function nextEntry(zip: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      zip.off('entry', onEntry);
      zip.off('end', onEnd);
      zip.off('error', onError);
    };
    const onEntry = (entry: Entry) => {
      cleanup();
      resolve(entry);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    zip.on('entry', onEntry);
    zip.on('end', onEnd);
    zip.on('error', onError);
    zip.readEntry();
  });
}

function openStream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream)));
  });
}

/** Walks every entry of the central directory; malformed archives become unsupported files. */
async function forEachEntry(
  buffer: Buffer,
  visit: (entry: Entry, zip: ZipFile) => Promise<void>,
): Promise<void> {
  const zip = await open(buffer);
  try {
    for (;;) {
      let entry: Entry | null;
      try {
        entry = await nextEntry(zip);
      } catch {
        throw new ImportError('unsupported_file');
      }
      if (!entry) return;
      await visit(entry, zip);
    }
  } finally {
    zip.close();
  }
}

/** Lists the entries from the central directory and checks every bound, without decompressing. */
export async function inspectZip(buffer: Buffer, limits: ArchiveLimits): Promise<ZipEntryInfo[]> {
  const entries: ZipEntryInfo[] = [];
  let total = 0;
  await forEachEntry(buffer, async (entry, zip) => {
    if (zip.entryCount > limits.maxEntries) throw new ImportError('file_too_complex');
    if (entry.isEncrypted()) throw new ImportError('file_protected');
    if (!entry.canDecodeFileData()) throw new ImportError('unsupported_file');
    const { compressedSize, uncompressedSize } = entry;
    total += uncompressedSize;
    const ratio = uncompressedSize / Math.max(compressedSize, 1);
    if (
      uncompressedSize > limits.maxEntryUncompressedBytes ||
      total > limits.maxTotalUncompressedBytes ||
      (uncompressedSize >= limits.minRatioCheckBytes && ratio > limits.maxCompressionRatio)
    ) {
      throw new ImportError('file_too_complex');
    }
    entries.push({ name: entry.fileName, compressedSize, uncompressedSize });
  });
  return entries;
}

async function readStream(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > maxBytes) throw new ImportError('file_too_complex');
      chunks.push(chunk);
    }
  } catch (error) {
    stream.destroy();
    // A size that does not match the headers, or corrupted data: never trust such an archive.
    throw error instanceof ImportError ? error : new ImportError('file_too_complex');
  }
  return Buffer.concat(chunks);
}

/**
 * Reads the entries `wanted` selects, after checking the bounds on the whole archive. With
 * `verifyAll`, every other entry is also decompressed (and dropped) so that no entry lies about
 * its size before another library opens the archive.
 */
export async function readZipEntries(
  buffer: Buffer,
  limits: ArchiveLimits,
  wanted: (name: string) => boolean,
  options: { verifyAll?: boolean } = {},
): Promise<Map<string, Buffer>> {
  await inspectZip(buffer, limits);
  const contents = new Map<string, Buffer>();
  let total = 0;
  await forEachEntry(buffer, async (entry, zip) => {
    const keep = wanted(entry.fileName);
    if (!keep && !options.verifyAll) return;
    if (entry.fileName.endsWith('/')) return;
    let stream: Readable;
    try {
      stream = await openStream(zip, entry);
    } catch {
      throw new ImportError('unsupported_file');
    }
    const data = await readStream(stream, limits.maxEntryUncompressedBytes);
    total += data.length;
    if (total > limits.maxTotalUncompressedBytes) throw new ImportError('file_too_complex');
    if (keep) contents.set(entry.fileName, data);
  });
  return contents;
}
