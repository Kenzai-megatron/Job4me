import { existsSync } from 'node:fs';
import { COMPOSE, ENV_FILE, run } from './lib';

// `pnpm dev`: one command starts PostgreSQL and Mailpit, applies migrations,
// then runs the API, the worker and the interface in watch mode.

async function main(): Promise<void> {
  if (!existsSync(ENV_FILE)) await run('pnpm', ['setup:dev']);
  console.log('Starting PostgreSQL and Mailpit…');
  await run('docker', [...COMPOSE, 'up', '-d', '--wait', 'postgres', 'mailpit']);
  console.log('Applying migrations…');
  await run('pnpm', ['--filter', '@job4me/db', 'migrate']);
  console.log('Starting the API, the worker and the interface…');
  await run('pnpm', ['exec', 'turbo', 'run', 'dev', '--filter=./apps/*']);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
