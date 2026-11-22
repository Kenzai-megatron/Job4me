import { randomBytes } from 'node:crypto';
import { loadConfig, readSecret } from '@job4me/config';
import pg from 'pg';
import { runMigrations } from './migrate';

export interface TestDatabase {
  name: string;
  ownerUrl: string;
  appUrl: string;
  drop: () => Promise<void>;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Creates a throwaway database on the development server, migrated and granted like the real one.
 * Integration tests only: needs JOB4ME_DATABASE_OWNER_URL and JOB4ME_DATABASE_URL (from .env or CI).
 */
export async function createTestDatabase(prefix: string): Promise<TestDatabase> {
  process.env.JOB4ME_ENV ??= 'test';
  loadConfig();
  const ownerServerUrl = readSecret('JOB4ME_DATABASE_OWNER_URL');
  const appServerUrl = readSecret('JOB4ME_DATABASE_URL');
  if (!ownerServerUrl || !appServerUrl) {
    throw new Error('integration tests need JOB4ME_DATABASE_OWNER_URL and JOB4ME_DATABASE_URL');
  }
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
