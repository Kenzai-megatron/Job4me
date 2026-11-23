import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImportRun } from '@job4me/contracts';
import { rawConnection } from '@job4me/db/testing';
import { storagePath, uploadAad } from '@job4me/imports';
import {
  makeDocx,
  makeLinkedinArchive,
  makePdf,
  makeZip,
  makeZipBomb,
} from '@job4me/imports/testing';
import { decrypt } from '@job4me/security';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './testing/app';
import { signedInBrowser } from './testing/session';

// Uploads (phase 1 plan, section 6, threats 1, 2, 9 and 12).

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx?.close();
});

const cv = makePdf([['Alex Exemple', 'Analyste de données à Bruxelles']]);
const file = (content: Buffer, filename = 'document.bin', type = 'application/octet-stream') => [
  { name: 'file', filename, type, content },
];

describe('upload', () => {
  it('detects the real type, encrypts the file under a random name and queues it', async () => {
    const { browser } = await signedInBrowser(ctx, 'upload');
    // The name and the announced type are ignored: only the content counts.
    const response = await browser.upload('/api/imports', file(cv, 'photo.jpg', 'image/jpeg'));
    expect(response.statusCode).toBe(200);
    const run = response.json<ImportRun>();
    expect(run).toMatchObject({
      kind: 'cv_pdf',
      status: 'queued',
      errorCode: null,
      sizeBytes: cv.length,
      stats: null,
    });

    const db = await rawConnection(ctx.database.ownerUrl);
    try {
      const { rows } = await db.query<{ id: string; storage_key: string; sha256: string }>(
        'select u.id, u.storage_key, u.sha256 from upload u join import_run r on r.upload_id = u.id where r.id = $1',
        [run.id],
      );
      const upload = rows[0]!;
      const stored = readFileSync(storagePath(ctx.deps.imports.filesDir, upload.storage_key));
      // Nothing readable at rest, but the import key opens it, bound to its upload row.
      expect(stored.includes(Buffer.from('%PDF'))).toBe(false);
      expect(stored.includes(Buffer.from('Alex'))).toBe(false);
      expect(decrypt(ctx.deps.imports.key, stored, uploadAad(upload.id)).equals(cv)).toBe(true);
      expect(() => decrypt(ctx.deps.imports.key, stored, uploadAad(run.id))).toThrow();
      const audit = await db.query<{ metadata: Record<string, unknown> }>(
        "select metadata from audit_log where action = 'import.uploaded'",
      );
      expect(audit.rows.at(-1)?.metadata).toEqual({ kind: 'cv_pdf', sizeBytes: cv.length });
    } finally {
      await db.end();
    }
  });

  it('accepts a DOCX and a LinkedIn archive', async () => {
    const { browser } = await signedInBrowser(ctx, 'kinds');
    const docx = await browser.upload('/api/imports', file(makeDocx(['Alex Exemple'])));
    expect(docx.json<ImportRun>().kind).toBe('cv_docx');
    const linkedin = await browser.upload('/api/imports', file(makeLinkedinArchive()));
    expect(linkedin.json<ImportRun>().kind).toBe('linkedin_zip');
  });

  it('refuses trapped or unexpected files with a clear code, and stores nothing', async () => {
    const { browser } = await signedInBrowser(ctx, 'refusals');
    const before = readdirSync(join(ctx.deps.imports.filesDir, 'imports')).length;
    const cases: [Buffer, number, string][] = [
      [Buffer.from('MZ\x90\x00 not a document'), 415, 'unsupported_file'],
      [makeZip({ 'notes.txt': 'rien' }), 415, 'unsupported_file'],
      [makeDocx(['x'], { vbaProject: true }), 422, 'file_macros'],
      [makeZipBomb(30), 422, 'file_too_complex'],
      [
        Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024)]),
        413,
        'file_too_large',
      ],
    ];
    for (const [content, status, error] of cases) {
      const response = await browser.upload('/api/imports', file(content));
      expect(response.statusCode, error).toBe(status);
      expect(response.json()).toMatchObject({ error });
    }
    expect(readdirSync(join(ctx.deps.imports.filesDir, 'imports')).length).toBe(before);
  });

  it('takes one file and nothing else', async () => {
    const { browser } = await signedInBrowser(ctx, 'parts');
    const two = await browser.upload('/api/imports', [...file(cv), ...file(cv)]);
    expect(two.statusCode).toBe(400);
    const field = await browser.upload('/api/imports', [
      { name: 'note', content: 'bonjour' },
      ...file(cv),
    ]);
    expect(field.statusCode).toBe(400);
    const none = await browser.upload('/api/imports', []);
    expect(none.statusCode).toBe(400);
    const json = await browser.post('/api/imports', { file: 'x' });
    expect(json.statusCode).toBe(415);
  });

  it('requires a session and the CSRF token', async () => {
    const { browser } = await signedInBrowser(ctx, 'csrf');
    const forged = await browser.upload('/api/imports', file(cv), { 'x-csrf-token': 'forged' });
    expect(forged.statusCode).toBe(403);
    const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/imports' });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('import runs', () => {
  it('lists and shows the runs of the signed-in user only', async () => {
    const alice = await signedInBrowser(ctx, 'alice');
    const bob = await signedInBrowser(ctx, 'bob');
    const mine = (await alice.browser.upload('/api/imports', file(cv))).json<ImportRun>();
    const list = (await alice.browser.get('/api/imports')).json<{ items: ImportRun[] }>();
    expect(list.items.map((item) => item.id)).toEqual([mine.id]);
    expect((await alice.browser.get(`/api/imports/${mine.id}`)).statusCode).toBe(200);

    expect((await bob.browser.get(`/api/imports/${mine.id}`)).statusCode).toBe(404);
    const theirs = (await bob.browser.get('/api/imports')).json<{ items: ImportRun[] }>();
    expect(theirs.items).toEqual([]);
  });

  it('deletes an import with its file and proposals, for its own account only (finding 14)', async () => {
    const alice = await signedInBrowser(ctx, 'delete-alice');
    const bob = await signedInBrowser(ctx, 'delete-bob');
    const run = (await alice.browser.upload('/api/imports', file(cv))).json<ImportRun>();
    const db = await rawConnection(ctx.database.ownerUrl);
    try {
      const { rows } = await db.query<{ storage_key: string; upload_id: string }>(
        'select u.storage_key, u.id as upload_id from import_run r join upload u on u.id = r.upload_id where r.id = $1',
        [run.id],
      );
      const path = storagePath(ctx.deps.imports.filesDir, rows[0]!.storage_key);
      expect(existsSync(path)).toBe(true);
      await db.query(
        "insert into import_proposal (user_id, import_run_id, rubric, source, content) values ($1, $2, 'skills', 'ai', '\\x00')",
        [alice.userId, run.id],
      );

      expect((await bob.browser.send('DELETE', `/api/imports/${run.id}`)).statusCode).toBe(404);
      expect(existsSync(path)).toBe(true);

      // Never while the extractor or the structuring works on it.
      await db.query("update import_run set status = 'extracting' where id = $1", [run.id]);
      const busy = await alice.browser.send('DELETE', `/api/imports/${run.id}`);
      expect(busy.statusCode).toBe(409);
      expect(busy.json()).toMatchObject({ error: 'import_in_progress' });
      await db.query("update import_run set status = 'review' where id = $1", [run.id]);

      const deleted = await alice.browser.send('DELETE', `/api/imports/${run.id}`);
      expect(deleted.statusCode).toBe(200);
      expect(existsSync(path)).toBe(false);
      for (const [table, column, value] of [
        ['import_run', 'id', run.id],
        ['upload', 'id', rows[0]!.upload_id],
        ['import_proposal', 'import_run_id', run.id],
      ] as const) {
        const left = await db.query(`select 1 from ${table} where ${column} = $1`, [value]);
        expect(left.rowCount, table).toBe(0);
      }
      const audit = await db.query(
        "select 1 from audit_log where action = 'import.deleted' and target_id = $1",
        [run.id],
      );
      expect(audit.rowCount).toBe(1);
      expect((await alice.browser.send('DELETE', `/api/imports/${run.id}`)).statusCode).toBe(404);
    } finally {
      await db.end();
    }
  });

  it('never serves the stored file', async () => {
    const { browser } = await signedInBrowser(ctx, 'serve');
    const run = (await browser.upload('/api/imports', file(cv))).json<ImportRun>();
    for (const url of [`/api/imports/${run.id}/file`, '/imports', '/var/files/imports']) {
      const response = await browser.get(url);
      expect(response.statusCode, url).toBe(404);
    }
    expect(existsSync(join(ctx.deps.imports.filesDir, 'imports'))).toBe(true);
  });
});
