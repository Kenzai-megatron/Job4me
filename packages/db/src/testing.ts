import { randomBytes } from 'node:crypto';
import { loadConfig, loadSecrets } from '@job4me/config';
import pg from 'pg';
import { runMigrations } from './migrate';

export interface TestDatabase {
  name: string;
  ownerUrl: string;
  appUrl: string;
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
): Promise<{ ownerUrl: string; appUrl: string }> {
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
  await runMigrations({ ownerUrl, appUrl });
  return { ownerUrl, appUrl };
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
  await runMigrations({ ownerUrl, appUrl });
  return {
    name,
    ownerUrl,
    appUrl,
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
