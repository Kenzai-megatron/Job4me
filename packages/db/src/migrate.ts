import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadLocalities } from './localities';

export const APP_ROLE = 'job4me_app';
/** Role of the isolated extractor (ADR 0010): the import tables, a few columns, nothing else. */
export const EXTRACTOR_ROLE = 'job4me_extractor';
export const QUEUE_SCHEMA = 'pgboss';

export interface MigrateOptions {
  /** Owner connection: owns the schema, applies migrations. */
  ownerUrl: string;
  /** Runtime connection: its user and password define the application role. */
  appUrl: string;
  /** Extractor connection: sets that role's password. Without it the role exists but cannot log in. */
  extractorUrl?: string;
  migrationsFolder?: string;
}

function defaultMigrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
}

function quoteIdent(client: pg.Client, value: string): string {
  return client.escapeIdentifier(value);
}

/** The password of a connection string, after checking it uses the expected role. */
function passwordFor(url: string, role: string, label: string): string {
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  if (user !== role) {
    throw new Error(`the ${label} connection must use the ${role} role, not ${user || '(none)'}`);
  }
  if (password.length < 16)
    throw new Error(`the ${label} role password must hold 16 characters or more`);
  return password;
}

/** Creates or updates a role without any privilege of its own (ADR 0006). */
async function ensureRole(client: pg.Client, role: string, password: string | undefined) {
  const exists =
    (await client.query('select 1 from pg_roles where rolname = $1', [role])).rowCount !== 0;
  const limits = 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS';
  if (password === undefined) {
    // Policies name the role, so it must exist; without credentials it cannot log in.
    if (!exists)
      await client.query(`CREATE ROLE ${quoteIdent(client, role)} WITH NOLOGIN ${limits}`);
    return;
  }
  await client.query(
    `${exists ? 'ALTER' : 'CREATE'} ROLE ${quoteIdent(client, role)} WITH LOGIN ${limits} PASSWORD ${client.escapeLiteral(password)}`,
  );
}

/** Least privilege for the runtime role; run after every migration so new tables are covered. */
async function applyGrants(client: pg.Client): Promise<void> {
  const role = quoteIdent(client, APP_ROLE);
  const extractor = quoteIdent(client, EXTRACTOR_ROLE);
  const database = quoteIdent(
    client,
    (await client.query<{ db: string }>('select current_database() as db')).rows[0]!.db,
  );
  const statements = [
    `GRANT CONNECT ON DATABASE ${database} TO ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `REVOKE CREATE ON SCHEMA public FROM ${role}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    `REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM ${role}`,
    // The AI call log feeds the spending caps (ADR 0009): written once, never rewritten.
    `REVOKE UPDATE, DELETE, TRUNCATE ON "ai_call" FROM ${role}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    // Readiness check: the runtime role may count applied migrations, nothing more.
    `GRANT USAGE ON SCHEMA drizzle TO ${role}`,
    `GRANT SELECT ON drizzle.__drizzle_migrations TO ${role}`,
    // pg-boss creates its own queue tables: its schema belongs to the runtime role.
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(client, QUEUE_SCHEMA)} AUTHORIZATION ${role}`,
    // Extractor: reset, then a few columns of the two import tables (row-level security too).
    `GRANT CONNECT ON DATABASE ${database} TO ${extractor}`,
    `GRANT USAGE ON SCHEMA public TO ${extractor}`,
    `REVOKE CREATE ON SCHEMA public FROM ${extractor}`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${extractor}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${extractor}`,
    `GRANT SELECT (id, user_id, kind, size_bytes, storage_key) ON "upload" TO ${extractor}`,
    `GRANT SELECT (id, user_id, upload_id, status, attempts, claimed_at, created_at) ON "import_run" TO ${extractor}`,
    `GRANT UPDATE (status, error_code, attempts, claimed_at, extracted_at, extracted, stats, updated_at) ON "import_run" TO ${extractor}`,
  ];
  for (const statement of statements) await client.query(statement);
  // Public data loaded by the migration (ADR 0017): read only for the application.
  for (const table of ['locality', 'dataset']) {
    const exists = await client.query<{ name: string | null }>(
      'select to_regclass($1)::text as name',
      [`public.${table}`],
    );
    if (exists.rows[0]?.name) {
      await client.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "${table}" FROM ${role}`);
    }
  }
}

/** Applies pending migrations, then the role and grants. Idempotent. */
export async function runMigrations(options: MigrateOptions): Promise<void> {
  const client = new pg.Client({
    connectionString: options.ownerUrl,
    application_name: 'job4me-migrate',
  });
  await client.connect();
  try {
    await ensureRole(client, APP_ROLE, passwordFor(options.appUrl, APP_ROLE, 'runtime'));
    await ensureRole(
      client,
      EXTRACTOR_ROLE,
      options.extractorUrl
        ? passwordFor(options.extractorUrl, EXTRACTOR_ROLE, 'extractor')
        : undefined,
    );
    const folder = options.migrationsFolder ?? defaultMigrationsFolder();
    await migrate(drizzle(client), { migrationsFolder: folder });
    // The Belgian localities (ADR 0017): loaded when their file changed, after its fingerprint.
    await loadLocalities(client, folder);
    await applyGrants(client);
  } finally {
    await client.end();
  }
}
