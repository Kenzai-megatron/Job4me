import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { createTestDatabase, type TestDatabase } from './testing';

let database: TestDatabase;
let owner: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  database = await createTestDatabase('db');
  owner = new pg.Client({ connectionString: database.ownerUrl });
  app = new pg.Client({ connectionString: database.appUrl });
  await owner.connect();
  await app.connect();
});

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await database?.drop();
});

describe('migrations', () => {
  it('create the phase 0 and phase 1 tables', async () => {
    const { rows } = await owner.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(rows.map((row) => row.tablename)).toEqual([
      'ai_call',
      'audit_log',
      'auth_challenge',
      'auth_throttle',
      'certification',
      'education',
      'elimination_rule',
      'excluded_company',
      'experience',
      'fact',
      'import_proposal',
      'import_run',
      'keyword_proposal_run',
      'language_level',
      'one_time_token',
      'passkey',
      'past_application',
      'profile',
      'profile_identity',
      'push_subscription',
      'recovery_code',
      'saved_offer',
      'search_keyword',
      'sector_preference',
      'session',
      'skill',
      'target_job',
      'title_filter_rule',
      'totp_secret',
      'upload',
      'user',
    ]);
  });

  it('turn on row-level security for every profile table (ADR 0011)', async () => {
    const { rows } = await owner.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
    );
    const guarded = rows.filter((row) => row.relrowsecurity).map((row) => row.relname);
    for (const table of [
      'profile',
      'profile_identity',
      'skill',
      'experience',
      'fact',
      'search_keyword',
      'upload',
      'import_run',
      'import_proposal',
      'ai_call',
      'keyword_proposal_run',
      'saved_offer',
      'past_application',
    ]) {
      expect(guarded).toContain(table);
    }
    expect(guarded).not.toContain('session');
  });

  it('are idempotent', async () => {
    await expect(
      runMigrations({
        ownerUrl: database.ownerUrl,
        appUrl: database.appUrl,
        extractorUrl: database.extractorUrl,
      }),
    ).resolves.toBeUndefined();
  });

  it('generate UUIDv7 identifiers', async () => {
    const { rows } = await app.query<{ id: string }>(
      "insert into \"user\" (email, display_name, webauthn_user_handle) values ('a@example.org', 'A', '\\x01') returning id",
    );
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });
});

describe('views', () => {
  it('show the ready imports to the application across accounts, ids only', async () => {
    const { rows } = await owner.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'import_run_ready' order by ordinal_position",
    );
    expect(rows.map((row) => row.column_name)).toEqual(['id', 'user_id', 'status', 'updated_at']);
    await expect(app.query('select count(*) from import_run_ready')).resolves.toBeTruthy();
    const done = await owner.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'import_run_done' order by ordinal_position",
    );
    expect(done.rows.map((row) => row.column_name)).toEqual(['id', 'user_id', 'updated_at']);
  });
});

describe('extractor role (ADR 0010)', () => {
  it('has no rights of its own and only a few columns of the import tables', async () => {
    const { rows } = await owner.query(
      "select rolsuper, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles where rolname = 'job4me_extractor'",
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
    });
    const tables = await owner.query<{ table_name: string }>(
      "select distinct table_name from information_schema.column_privileges where grantee = 'job4me_extractor' order by table_name",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(['import_run', 'upload']);
    const whole = await owner.query(
      "select table_name from information_schema.table_privileges where grantee = 'job4me_extractor'",
    );
    expect(whole.rows).toEqual([]);
  });
});

describe('runtime role (ADR 0006)', () => {
  it('has no superuser, role creation or RLS bypass rights', async () => {
    const { rows } = await owner.query(
      "select rolsuper, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles where rolname = 'job4me_app'",
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
    });
  });

  it('cannot change the business schema', async () => {
    await expect(app.query('create table public.intruder (x int)')).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query('alter table "user" add column intruder int')).rejects.toThrow(/owner/);
  });

  it('can manage the queue schema used by pg-boss', async () => {
    await app.query('create table pgboss.probe (x int)');
    await app.query('drop table pgboss.probe');
  });
});

describe('audit log', () => {
  it('accepts inserts and reads from the runtime role', async () => {
    await app.query(
      "insert into audit_log (actor_type, action, outcome) values ('system', 'test.event', 'success')",
    );
    const { rows } = await app.query('select count(*)::int as n from audit_log');
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('refuses updates and deletes from the runtime role', async () => {
    await expect(app.query("update audit_log set action = 'forged'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query('delete from audit_log')).rejects.toThrow(/permission denied/);
  });

  it('refuses updates, deletes and truncation even from the owner', async () => {
    await expect(owner.query("update audit_log set action = 'forged'")).rejects.toThrow(
      /append-only/,
    );
    await expect(owner.query('delete from audit_log')).rejects.toThrow(/append-only/);
    await expect(owner.query('truncate audit_log')).rejects.toThrow(/append-only/);
  });
});
