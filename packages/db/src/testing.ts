import { randomBytes } from 'node:crypto';
import { loadConfig, loadSecrets } from '@job4me/config';
import pg from 'pg';
import { runMigrations } from './migrate';

export interface TestDatabase {
  name: string;
  ownerUrl: string;
  appUrl: string;
  /** The extractor role's connection, when the environment provides its password. */
  extractorUrl: string | undefined;
  drop: () => Promise<void>;
}

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** Drops then creates a database on the development server, migrated and granted (tests only). */
export async function recreateDatabase(
  ownerServerUrl: string,
  appServerUrl: string,
  name: string,
  extractorServerUrl?: string,
): Promise<{ ownerUrl: string; appUrl: string; extractorUrl: string | undefined }> {
  const admin = new pg.Client({ connectionString: withDatabase(ownerServerUrl, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(name)} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(name)}`);
  } finally {
    await admin.end();
  }
  const ownerUrl = withDatabase(ownerServerUrl, name);
  const appUrl = withDatabase(appServerUrl, name);
  const extractorUrl = extractorServerUrl ? withDatabase(extractorServerUrl, name) : undefined;
  await runMigrations({ ownerUrl, appUrl, extractorUrl });
  return { ownerUrl, appUrl, extractorUrl };
}

/**
 * Creates a throwaway database on the development server, migrated and granted like the real one.
 * Integration tests only: needs JOB4ME_DATABASE_OWNER_URL and JOB4ME_DATABASE_URL (from .env or CI).
 */
export async function createTestDatabase(prefix: string): Promise<TestDatabase> {
  process.env.JOB4ME_ENV ??= 'test';
  loadConfig();
  const secrets = loadSecrets();
  const ownerServerUrl = secrets.databaseOwnerUrl;
  const appServerUrl = secrets.databaseUrl;
  if (!ownerServerUrl) throw new Error('integration tests need the database owner credentials');
  const name = `job4me_test_${prefix}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: withDatabase(ownerServerUrl, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(name)}`);
  } finally {
    await admin.end();
  }
  const ownerUrl = withDatabase(ownerServerUrl, name);
  const appUrl = withDatabase(appServerUrl, name);
  const extractorUrl = secrets.databaseExtractorUrl
    ? withDatabase(secrets.databaseExtractorUrl, name)
    : undefined;
  await runMigrations({ ownerUrl, appUrl, extractorUrl });
  return {
    name,
    ownerUrl,
    appUrl,
    extractorUrl,
    drop: async () => {
      const client = new pg.Client({ connectionString: withDatabase(ownerServerUrl, 'postgres') });
      await client.connect();
      try {
        await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(name)} WITH (FORCE)`);
      } finally {
        await client.end();
      }
    },
  };
}

/** A plain connection for tests that must bypass the application code (row-level security). */
export async function rawConnection(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}
