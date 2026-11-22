import { loadConfig, loadSecrets } from '@job4me/config';
import { runMigrations } from '@job4me/db';

// Container entry point (`node api/migrate.js`): migrations, runtime role and grants.
async function main(): Promise<void> {
  loadConfig();
  const secrets = loadSecrets();
  if (!secrets.databaseOwnerUrl) throw new Error('the owner credentials are required to migrate');
  await runMigrations({
    ownerUrl: secrets.databaseOwnerUrl,
    appUrl: secrets.databaseUrl,
    extractorUrl: secrets.databaseExtractorUrl,
    ...(process.env.JOB4ME_MIGRATIONS_DIR
      ? { migrationsFolder: process.env.JOB4ME_MIGRATIONS_DIR }
      : {}),
  });
  process.stdout.write('Migrations applied.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(
    `migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
