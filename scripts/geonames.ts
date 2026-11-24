import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { deriveLocalities, readZipEntry, sha256, toTsv } from './geonames-lib';
import { ROOT } from './lib';

// `pnpm geonames` (ADR 0017, decision D6): rebuilds the Belgian localities file from GeoNames
// (CC BY 4.0) and writes its fingerprint where the migration checks it. Three downloads, one
// after the other; `--from <folder>` reads them from a folder laid out like the GeoNames site
// (zip/BE.zip, dump/BE.zip, dump/alternatenames/BE.zip) instead. Review the diff before
// committing: the next migration loads the new file.

const SITE = 'https://download.geonames.org/export';
const FILES = {
  postal: 'zip/BE.zip',
  places: 'dump/BE.zip',
  alternates: 'dump/alternatenames/BE.zip',
} as const;
const OUTPUT = join(ROOT, 'packages', 'db', 'drizzle', 'data', 'localities.tsv');
const FINGERPRINT = join(ROOT, 'packages', 'db', 'src', 'localities.ts');

async function archive(path: string, from: string | undefined): Promise<Buffer> {
  if (from) return readFileSync(join(from, path));
  const response = await fetch(`${SITE}/${path}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  const index = process.argv.indexOf('--from');
  const from = index > 0 ? process.argv[index + 1] : undefined;
  const text: Record<keyof typeof FILES, string> = { postal: '', places: '', alternates: '' };
  for (const [name, path] of Object.entries(FILES) as Array<[keyof typeof FILES, string]>) {
    text[name] = readZipEntry(await archive(path, from), 'BE.txt').toString('utf8');
    if (!from) await sleep(1000);
  }
  const localities = deriveLocalities(text);
  const tsv = toTsv(localities, new Date().toISOString().slice(0, 10));
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, tsv);
  const digest = sha256(tsv);
  const source = readFileSync(FINGERPRINT, 'utf8');
  const updated = source.replace(
    /export const LOCALITIES_SHA256 = '[0-9a-f]{64}';/,
    `export const LOCALITIES_SHA256 = '${digest}';`,
  );
  if (updated === source && !source.includes(digest)) {
    throw new Error('LOCALITIES_SHA256 not found in packages/db/src/localities.ts');
  }
  writeFileSync(FINGERPRINT, updated);
  const named = localities.filter((locality) => locality.names.length > 0).length;
  console.log(
    `${localities.length} localités (${named} avec d'autres noms), empreinte ${digest.slice(0, 12)}…`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
