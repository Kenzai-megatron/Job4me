import { loadConfig, loadSecrets } from '@job4me/config';
import { runMigrations } from './migrate';

// `pnpm --filter @job4me/db migrate`: applies migrations with the owner connection.
async function main(): Promise<void> {
  loadConfig();
  const secrets = loadSecrets();
  if (!secrets.databaseOwnerUrl) {
    throw new Error('JOB4ME_DATABASE_OWNER_URL is required to apply migrations');
  }
  await runMigrations({
    ownerUrl: secrets.databaseOwnerUrl,
    appUrl: secrets.databaseUrl,
    extractorUrl: secrets.databaseExtractorUrl,
  });
  console.log('Migrations applied.');
}

main().catch((error: unknown) => {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
