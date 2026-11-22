import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadConfig } from '@job4me/config';
import { extractedDocumentSchema, type ImportKind } from '@job4me/contracts';
import { connect, type DatabaseHandle, eq, schema, withUser } from '@job4me/db';
import { createTestDatabase, rawConnection, type TestDatabase } from '@job4me/db/testing';
import { extractedAad, storagePath, uploadAad } from '@job4me/imports/extract';
import { makeDocx, makeLinkedinArchive, makePdf, THIRD_PARTY_NAMES } from '@job4me/imports/testing';
import { createLogger } from '@job4me/logger';
import { decrypt, encrypt, randomToken } from '@job4me/security';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimNext, type ExtractorDeps, processNext } from './extractor/extractor';
import { checkOutcome, threadRunner } from './extractor/runner';

// The extractor against a real database, with the job4me_extractor role (ADR 0010).

let database: TestDatabase;
let app: DatabaseHandle;
let extractor: DatabaseHandle;
let userId: string;
let filesDir: string;
const key = randomBytes(32);
const settings = (() => {
  process.env.JOB4ME_ENV ??= 'test';
  return loadConfig().settings.imports;
})();
// The memory budget of the configuration, as in the extract container.
const runner = threadRunner({
  limits: settings,
  timeoutMs: 20_000,
  memoryMb: settings.extractor.memoryMb,
});

beforeAll(async () => {
  database = await createTestDatabase('extractor');
  if (!database.extractorUrl) {
    throw new Error('set JOB4ME_DATABASE_EXTRACTOR_URL or JOB4ME_DB_EXTRACTOR_PASSWORD(_FILE)');
  }
  app = connect(database.appUrl, { max: 2 });
  extractor = connect(database.extractorUrl, { max: 2 });
  const [user] = await app.db
    .insert(schema.users)
    .values({ email: 'extract@example.org', displayName: 'E', webauthnUserHandle: randomBytes(32) })
    .returning();
  userId = user!.id;
  filesDir = mkdtempSync(join(tmpdir(), 'job4me-extract-'));
});

afterAll(async () => {
  await extractor?.close();
  await app?.close();
  await database?.drop();
  if (filesDir) rmSync(filesDir, { recursive: true, force: true });
});

const deps = (): ExtractorDeps => ({
  db: extractor.db,
  key,
  filesDir,
  logger: createLogger({ name: 'test', level: 'silent' }),
  runner,
  maxAttempts: 3,
  staleAfterMs: 60_000,
});

/** Does what the API does on upload: encrypted file under a random name, then a queued run. */
async function queue(kind: ImportKind, content: Buffer): Promise<string> {
  return withUser(app.db, userId, async (tx) => {
    const storageKey = randomToken(32);
    const [upload] = await tx
      .insert(schema.uploads)
      .values({ userId, kind, sizeBytes: content.length, sha256: '0'.repeat(64), storageKey })
      .returning({ id: schema.uploads.id });
    const path = storagePath(filesDir, storageKey);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, encrypt(key, content, uploadAad(upload!.id)));
    const [run] = await tx
      .insert(schema.importRuns)
      .values({ userId, uploadId: upload!.id })
      .returning({ id: schema.importRuns.id });
    return run!.id;
  });
}

async function run(id: string) {
  const [row] = await withUser(app.db, userId, (tx) =>
    tx.select().from(schema.importRuns).where(eq(schema.importRuns.id, id)),
  );
  return row!;
}

async function drain() {
  while (await processNext(deps()));
}

describe('extraction', () => {
  it('answers from the thread within its budgets', async () => {
    // Printed in full on failure: the reason tells memory, crash and exit apart.
    expect(await runner('cv_pdf', makePdf([['Alex Exemple']]))).toMatchObject({ ok: true });
    expect(await runner('cv_docx', makeDocx(['Alex Exemple']))).toMatchObject({ ok: true });
  });

  it('reads a PDF in a thread and stores the text encrypted, with figures only in clear', async () => {
    const id = await queue('cv_pdf', makePdf([['Alex Exemple', 'Analyste de données']]));
    await drain();
    const row = await run(id);
    expect(row).toMatchObject({ status: 'extracted', errorCode: null, attempts: 1 });
    expect(row.stats).toMatchObject({ pages: 1 });
    expect(row.extracted!.toString('latin1')).not.toContain('Alex');
    const document = extractedDocumentSchema.parse(
      JSON.parse(decrypt(key, row.extracted!, extractedAad(id)).toString('utf8')),
    );
    expect(document).toMatchObject({ kind: 'text', pages: 1 });
    if (document.kind === 'text') expect(document.text).toContain('Analyste de données');
  });

  it('reads a DOCX and the allow-listed files of a LinkedIn archive', async () => {
    const docx = await queue('cv_docx', makeDocx(['Alex Exemple', 'SQL']));
    const linkedin = await queue('linkedin_zip', makeLinkedinArchive());
    await drain();
    expect((await run(docx)).status).toBe('extracted');
    const row = await run(linkedin);
    expect(row.status).toBe('extracted');
    const text = decrypt(key, row.extracted!, extractedAad(linkedin)).toString('utf8');
    for (const name of THIRD_PARTY_NAMES) expect(text).not.toContain(name);
  });

  it('records why a file could not be read', async () => {
    const protectedPdf = await queue('cv_pdf', makePdf([['x']], { encrypted: true }));
    const scan = await queue('cv_pdf', makePdf([[]]));
    const mislabelled = await queue('cv_docx', makePdf([['x']]));
    await drain();
    expect(await run(protectedPdf)).toMatchObject({
      status: 'failed',
      errorCode: 'file_protected',
    });
    expect(await run(scan)).toMatchObject({ status: 'failed', errorCode: 'no_text' });
    expect(await run(mislabelled)).toMatchObject({
      status: 'failed',
      errorCode: 'unsupported_file',
    });
  });

  it('fails a run whose file was tampered with or is missing', async () => {
    const id = await queue('cv_pdf', makePdf([['x']]));
    const [upload] = await withUser(app.db, userId, (tx) =>
      tx
        .select({ storageKey: schema.uploads.storageKey })
        .from(schema.uploads)
        .innerJoin(schema.importRuns, eq(schema.importRuns.uploadId, schema.uploads.id))
        .where(eq(schema.importRuns.id, id)),
    );
    writeFileSync(storagePath(filesDir, upload!.storageKey), randomBytes(200));
    await drain();
    expect(await run(id)).toMatchObject({ status: 'failed', errorCode: 'extraction_failed' });
  });

  it('stops a thread that runs too long', async () => {
    const slow = threadRunner({ limits: settings, timeoutMs: 1, memoryMb: 128 });
    expect(await slow('cv_pdf', makePdf([['x']]))).toEqual({
      ok: false,
      code: 'extraction_timeout',
      reason: 'timeout',
    });
  });

  it('checks the answer of the thread like untrusted input', () => {
    expect(checkOutcome({ ok: true, document: { kind: 'shell' }, stats: {} }, settings)).toEqual({
      ok: false,
      code: 'extraction_failed',
      reason: 'invalid_answer',
    });
    expect(checkOutcome({ ok: false, code: 'rm -rf' }, settings)).toEqual({
      ok: false,
      code: 'extraction_failed',
    });
    const huge = { kind: 'text', text: 'x'.repeat(settings.maxExtractedChars + 1), pages: 1 };
    expect(checkOutcome({ ok: true, document: huge, stats: {} }, settings)).toEqual({
      ok: false,
      code: 'file_too_complex',
    });
  });
});

describe('claims', () => {
  it('takes a stalled extraction again, then gives up after the last attempt', async () => {
    await drain();
    const id = await queue('cv_pdf', makePdf([['x']]));
    const owner = await rawConnection(database.ownerUrl);
    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        expect((await claimNext(extractor.db, 60_000))?.id).toBe(id);
        // The extractor stopped mid-file: the claim is now older than staleAfterMs.
        await owner.query(
          "update import_run set claimed_at = now() - interval '2 minutes' where id = $1",
          [id],
        );
      }
    } finally {
      await owner.end();
    }
    expect(await processNext(deps())).toBe(true);
    expect(await run(id)).toMatchObject({
      status: 'failed',
      errorCode: 'extraction_failed',
      attempts: 4,
    });
  });
});

describe('job4me_extractor role', () => {
  it('reads and writes the few columns it needs, and nothing else', async () => {
    const id = await queue('cv_pdf', makePdf([['x']]));
    const client = await rawConnection(database.extractorUrl!);
    const denied = async (query: string, values: unknown[] = []) => {
      await expect(client.query(query, values)).rejects.toThrow(
        /permission denied|row-level security/,
      );
    };
    try {
      await expect(client.query('select id, kind, storage_key from upload')).resolves.toBeTruthy();
      await denied('select sha256 from upload');
      await denied('select extracted from import_run');
      await denied('select * from "user"');
      await denied('select * from session');
      await denied('select * from profile_identity');
      await denied('select * from audit_log');
      await denied(
        'insert into import_run (user_id, upload_id) select user_id, upload_id from import_run limit 1',
      );
      await denied('delete from import_run');
      await denied('update import_run set user_id = user_id where id = $1', [id]);
      await denied('update upload set kind = kind');
      // Row-level security: never into the steps of the worker or of Mehdi.
      await denied("update import_run set status = 'applied' where id = $1", [id]);
      await denied('create table stolen (x text)');
    } finally {
      await client.end();
    }
  });
});
