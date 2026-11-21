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
  it('create the phase 0 tables', async () => {
    const { rows } = await owner.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(rows.map((row) => row.tablename)).toEqual([
      'audit_log',
      'auth_challenge',
      'auth_throttle',
      'one_time_token',
      'passkey',
      'push_subscription',
      'recovery_code',
      'session',
      'totp_secret',
      'user',
    ]);
  });

  it('are idempotent', async () => {
    await expect(
      runMigrations({ ownerUrl: database.ownerUrl, appUrl: database.appUrl }),
    ).resolves.toBeUndefined();
  });

  it('generate UUIDv7 identifiers', async () => {
    const { rows } = await app.query<{ id: string }>(
      "insert into \"user\" (email, display_name, webauthn_user_handle) values ('a@example.org', 'A', '\\x01') returning id",
    );
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
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
