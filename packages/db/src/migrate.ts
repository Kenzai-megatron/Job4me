import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const APP_ROLE = 'job4me_app';
export const QUEUE_SCHEMA = 'pgboss';

export interface MigrateOptions {
  /** Owner connection: owns the schema, applies migrations. */
  ownerUrl: string;
  /** Runtime connection: its user and password define the application role. */
  appUrl: string;
  migrationsFolder?: string;
}

function defaultMigrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
}

function quoteIdent(client: pg.Client, value: string): string {
  return client.escapeIdentifier(value);
}

/** Creates or updates the runtime role from the runtime connection string (ADR 0006). */
async function ensureAppRole(client: pg.Client, appUrl: string): Promise<void> {
  const url = new URL(appUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (user !== APP_ROLE) {
    throw new Error(
      `the runtime connection must use the ${APP_ROLE} role, not ${user || '(none)'}`,
    );
  }
  if (password.length < 16)
    throw new Error('the runtime role password must hold 16 characters or more');
  const exists = await client.query('select 1 from pg_roles where rolname = $1', [APP_ROLE]);
  const verb = exists.rowCount === 0 ? 'CREATE' : 'ALTER';
  await client.query(
    `${verb} ROLE ${quoteIdent(client, APP_ROLE)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${client.escapeLiteral(password)}`,
  );
}

/** Least privilege for the runtime role; run after every migration so new tables are covered. */
async function applyGrants(client: pg.Client): Promise<void> {
  const role = quoteIdent(client, APP_ROLE);
  const database = (await client.query<{ db: string }>('select current_database() as db')).rows[0]!
    .db;
  const statements = [
    `GRANT CONNECT ON DATABASE ${quoteIdent(client, database)} TO ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `REVOKE CREATE ON SCHEMA public FROM ${role}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    `REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM ${role}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    // Readiness check: the runtime role may count applied migrations, nothing more.
    `GRANT USAGE ON SCHEMA drizzle TO ${role}`,
    `GRANT SELECT ON drizzle.__drizzle_migrations TO ${role}`,
    // pg-boss creates its own queue tables: its schema belongs to the runtime role.
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(client, QUEUE_SCHEMA)} AUTHORIZATION ${role}`,
  ];
  for (const statement of statements) await client.query(statement);
}

/** Applies pending migrations, then the role and grants. Idempotent. */
export async function runMigrations(options: MigrateOptions): Promise<void> {
  const client = new pg.Client({
    connectionString: options.ownerUrl,
    application_name: 'job4me-migrate',
  });
  await client.connect();
  try {
    await ensureAppRole(client, options.appUrl);
    await migrate(drizzle(client), {
      migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder(),
    });
    await applyGrants(client);
  } finally {
    await client.end();
  }
}
