import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  backupDir,
  COUNT_MIGRATIONS,
  COUNT_ROWS,
  env,
  inPostgres,
  listBackups,
  OWNER,
  output,
  parseCounts,
  pipe,
  PsqlSession,
  requireAge,
  sha256File,
} from './backup-lib';

// `pnpm stack:restore-test` (ADR 0012): decrypts the latest backup (or --backup <stamp>) with the
// age private key given by JOB4ME_BACKUP_IDENTITY_FILE, restores the database into a throwaway
// one next to the real one, and checks migrations, every table's row count and the files. The
// real database is never touched; the throwaway one is always dropped.

async function main(): Promise<void> {
  const { values: options } = parseArgs({ options: { backup: { type: 'string' } } });
  const values = env();
  const identity = process.env.JOB4ME_BACKUP_IDENTITY_FILE ?? values.JOB4ME_BACKUP_IDENTITY_FILE;
  if (!identity || !existsSync(identity)) {
    throw new Error(
      'JOB4ME_BACKUP_IDENTITY_FILE must name the age private key file (from your password manager)',
    );
  }
  await requireAge();
  const dir = backupDir(values);
  const backups = listBackups(dir);
  const backup = options.backup
    ? backups.find((candidate) => candidate.stamp === options.backup)
    : backups[0];
  if (!backup) throw new Error(`no backup${options.backup ? ` ${options.backup}` : ''} in ${dir}`);
  const { manifest } = backup;
  const problems: string[] = [];

  const report = () => {
    console.error(`Restore test of ${backup.stamp} FAILED:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  };
  // A damaged or replaced copy stops here, before anything is decrypted.
  for (const part of [manifest.database, manifest.files]) {
    if ((await sha256File(join(dir, part.file))) !== part.sha256) {
      problems.push(`${part.file}: its fingerprint differs from the manifest`);
    }
  }
  if (problems.length > 0) report();

  const scratch = `job4me_restore_${randomBytes(4).toString('hex')}`;
  const [create, createArgs] = inPostgres(['createdb', '-U', OWNER, scratch]);
  await output(create, createArgs);
  try {
    await pipe(
      ['age', ['-d', '-i', identity, join(dir, manifest.database.file)]],
      inPostgres(['pg_restore', '-U', OWNER, '-d', scratch, '--exit-on-error']),
      ['age', 'pg_restore'],
    );
    const session = new PsqlSession(scratch);
    const rows = parseCounts(await session.run(COUNT_ROWS));
    const migrations = Number((await session.run(COUNT_MIGRATIONS)).trim());
    await session.close();
    if (migrations !== manifest.database.migrations) {
      problems.push(`migrations: ${migrations} restored, ${manifest.database.migrations} expected`);
    }
    for (const [table, expected] of Object.entries(manifest.database.rows)) {
      if (rows[table] !== expected) {
        problems.push(`${table}: ${rows[table] ?? 'missing'} rows restored, ${expected} expected`);
      }
    }
  } finally {
    const [drop, dropArgs] = inPostgres(['dropdb', '-U', OWNER, '--force', scratch]);
    await output(drop, dropArgs).catch(() => undefined);
  }

  let entries = 0;
  try {
    // bash, not sh: dash (sh on Debian and Ubuntu) has no pipefail.
    const listing = await output('bash', [
      '-c',
      'set -o pipefail; age -d -i "$1" "$2" | tar -tf -',
      'restore-test',
      identity,
      join(dir, manifest.files.file),
    ]);
    entries = listing.split('\n').filter((line) => line !== '' && !line.endsWith('/')).length;
  } catch {
    problems.push(`${manifest.files.file}: cannot be decrypted or read as an archive`);
  }
  if (entries !== manifest.files.entries) {
    problems.push(`files: ${entries} in the archive, ${manifest.files.entries} expected`);
  }

  if (problems.length > 0) report();
  const total = Object.values(manifest.database.rows).reduce((sum, count) => sum + count, 0);
  console.log(
    `Restore test of ${backup.stamp} passed: ${Object.keys(manifest.database.rows).length} tables, ${total} rows, ${entries} files.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
