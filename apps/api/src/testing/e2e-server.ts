import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig, readSecret } from '@job4me/config';
import { connect } from '@job4me/db';
import { recreateDatabase } from '@job4me/db/testing';
import { createLogger } from '@job4me/logger';
import { buildApp } from '../app';
import { deriveKeys } from '../context';
import { userCreate } from '../cli/commands';

// End-to-end tests only: a fresh database, one account with its enrollment link,
// then the real API serving the built interface. Never used outside tests.

const DATABASE = 'job4me_e2e';
export const E2E_EMAIL = 'e2e@example.org';
export const E2E_PASSWORD = 'phrase de passe des tests e2e'; // gitleaks:allow (test value)

async function main() {
  process.env.JOB4ME_ENV = 'test';
  const config = loadConfig();
  const ownerUrl = readSecret('JOB4ME_DATABASE_OWNER_URL');
  const appUrl = readSecret('JOB4ME_DATABASE_URL');
  const masterKey = readSecret('JOB4ME_MASTER_KEY');
  const stateFile = process.env.E2E_STATE_FILE;
  if (!ownerUrl || !appUrl || !masterKey || !stateFile) {
    throw new Error('e2e server needs database URLs, a master key and E2E_STATE_FILE');
  }

  const { appUrl: e2eAppUrl } = await recreateDatabase(ownerUrl, appUrl, DATABASE);

  const database = connect(e2eAppUrl, { max: 5 });
  const { link } = await userCreate(database.db, config, {
    email: E2E_EMAIL,
    name: 'Mehdi',
    password: E2E_PASSWORD,
  });
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ link, email: E2E_EMAIL, password: E2E_PASSWORD }));

  const app = await buildApp({
    config,
    db: database.db,
    keys: deriveKeys(masterKey),
    logger: createLogger({ name: 'e2e', level: 'warn' }),
    webDistDir: process.env.JOB4ME_WEB_DIST,
  });
  await app.listen({ host: config.settings.app.listenHost, port: config.settings.app.listenPort });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `e2e server failed: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
