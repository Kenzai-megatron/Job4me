import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '@job4me/config';
import {
  backupDir,
  COUNT_MIGRATIONS,
  COUNT_ROWS,
  DATABASE,
  env,
  filesDir,
  finished,
  inPostgres,
  listBackups,
  type Manifest,
  OWNER,
  output,
  parseCounts,
  PsqlSession,
  requireAge,
  sha256File,
  stampOf,
  toKeep,
} from './backup-lib';
import { ROOT } from './lib';

// `pnpm stack:backup` (ADR 0012): the database and the files folder, each encrypted with age for
// the public key JOB4ME_BACKUP_RECIPIENT, plus a manifest of row counts taken in the very snapshot
// of the dump. Then the retention of the configuration. Run nightly by a systemd timer.

async function main(): Promise<void> {
  const values = env();
  const recipient = values.JOB4ME_BACKUP_RECIPIENT;
  if (!recipient || !/^age1[0-9a-z]{58}$/.test(recipient)) {
    throw new Error('JOB4ME_BACKUP_RECIPIENT must be an age public key (age1…) in .env');
  }
  await requireAge();
  process.env.JOB4ME_CONFIG_DIR ??= join(ROOT, 'config');
  const { backups } = loadConfig({ env: { ...process.env, JOB4ME_ENV: 'test' } }).settings;

  const dir = backupDir(values);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const stamp = stampOf(new Date());
  const base = join(dir, `job4me-${stamp}`);
  const partial = (path: string) => `${path}.partial`;

  // One snapshot for the dump and the counts: they describe exactly the same data.
  const session = new PsqlSession(DATABASE);
  await session.run('begin isolation level repeatable read;');
  const snapshot = (await session.run('select pg_export_snapshot();')).trim();
  const [dumpCommand, dumpArgs] = inPostgres([
    'pg_dump',
    '-U',
    OWNER,
    '-d',
    DATABASE,
    '--format=custom',
    `--snapshot=${snapshot}`,
  ]);
  const dump = spawn(dumpCommand, dumpArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  const sealDump = spawn('age', ['-r', recipient, '-o', partial(`${base}.db.age`)], {
    cwd: ROOT,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  dump.stdout.pipe(sealDump.stdin);
  await Promise.all([finished(dump, 'pg_dump'), finished(sealDump, 'age')]);
  const rows = parseCounts(await session.run(COUNT_ROWS));
  const migrations = Number((await session.run(COUNT_MIGRATIONS)).trim());
  await session.run('commit;');
  await session.close();

  // The files folder, encrypted as it is (the files inside are already encrypted).
  const files = filesDir(values);
  const archive = spawn('tar', ['-C', dirname(files), '-cf', '-', 'files'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const sealFiles = spawn('age', ['-r', recipient, '-o', partial(`${base}.files.age`)], {
    cwd: ROOT,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  archive.stdout.pipe(sealFiles.stdin);
  await Promise.all([finished(archive, 'tar'), finished(sealFiles, 'age')]);
  const fileCount = (await output('find', [files, '-type', 'f']))
    .split('\n')
    .filter(Boolean).length;

  for (const part of [`${base}.db.age`, `${base}.files.age`]) {
    renameSync(partial(part), part);
    chmodSync(part, 0o600);
  }
  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    database: {
      file: `job4me-${stamp}.db.age`,
      sha256: await sha256File(`${base}.db.age`),
      migrations,
      rows,
    },
    files: {
      file: `job4me-${stamp}.files.age`,
      sha256: await sha256File(`${base}.files.age`),
      entries: fileCount,
    },
  };
  writeFileSync(`${base}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const total = Object.values(rows).reduce((sum, count) => sum + count, 0);
  console.log(
    `Backup ${stamp}: ${Object.keys(rows).length} tables, ${total} rows, ${fileCount} files, in ${dir}`,
  );

  // Retention: the newest backups, then one a week (configuration).
  const keep = toKeep(
    listBackups(dir).map((backup) => backup.stamp),
    backups.keepDaily,
    backups.keepWeekly,
  );
  for (const old of listBackups(dir)) {
    if (keep.has(old.stamp)) continue;
    for (const suffix of ['db.age', 'files.age', 'manifest.json']) {
      rmSync(join(dir, `job4me-${old.stamp}.${suffix}`), { force: true });
    }
    console.log(`Backup ${old.stamp} removed (retention).`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
