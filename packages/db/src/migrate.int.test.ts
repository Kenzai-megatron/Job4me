import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCALITIES_SHA256, loadLocalities } from './localities';
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
      'collection_pass',
      'dataset',
      'education',
      'elimination_rule',
      'excluded_company',
      'experience',
      'fact',
      'import_proposal',
      'import_run',
      'job_offer',
      'keyword_proposal_run',
      'language_level',
      'locality',
      'offer',
      'offer_score',
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
      'source_run',
      'source_setting',
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
      'source_setting',
      'collection_pass',
      'source_run',
      'job_offer',
      'offer',
      'offer_score',
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

describe('migration 0009 (ADR 0016)', () => {
  it('gives each posting of phase 2 its own announcement, to be identified by the worker', async () => {
    // The migrations as they were before 0009, then the posting of a collection pass.
    const folder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
    const before = await mkdtemp(join(tmpdir(), 'job4me-migrations-'));
    const journal = JSON.parse(await readFile(join(folder, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    journal.entries = journal.entries.filter((entry) => entry.idx < 9);
    await mkdir(join(before, 'meta'));
    await writeFile(join(before, 'meta', '_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries) {
      await copyFile(join(folder, `${entry.tag}.sql`), join(before, `${entry.tag}.sql`));
    }
    const old = await createTestDatabase('db0009', { migrationsFolder: before });
    const client = new pg.Client({ connectionString: old.ownerUrl });
    await client.connect();
    try {
      const { rows: users } = await client.query<{ id: string }>(
        "insert into \"user\" (email, display_name, webauthn_user_handle) values ('b@example.org', 'B', '\\x02') returning id",
      );
      const { rows: postings } = await client.query<{ id: string }>(
        `insert into job_offer (user_id, source, external_id, title, first_seen_at, last_seen_at)
         values ($1, 'actiris', 'a1', 'Comptable', now() - interval '3 days', now() - interval '1 day'),
                ($1, 'forem', 'f1', 'Comptable (H/F)', now() - interval '2 days', now())
         returning id`,
        [users[0]!.id],
      );

      await runMigrations({ ownerUrl: old.ownerUrl, appUrl: old.appUrl });
      const { rows: offers } = await client.query<{
        id: string;
        retained_id: string;
        same_sightings: boolean;
      }>(
        `select o.id, o.retained_id,
           o.first_seen_at = p.first_seen_at and o.last_seen_at = p.last_seen_at as same_sightings
         from offer o join job_offer p on p.offer_id = o.id order by o.id`,
      );
      expect(offers.map((offer) => offer.id).sort()).toEqual(postings.map((row) => row.id).sort());
      expect(offers.every((offer) => offer.retained_id === offer.id && offer.same_sightings)).toBe(
        true,
      );
      const { rows } = await client.query<{ versions: number[] }>(
        'select array_agg(distinct dedup_version) as versions from job_offer',
      );
      expect(rows[0]!.versions).toEqual([0]);
    } finally {
      await client.end();
      await old.drop();
      await rm(before, { recursive: true, force: true });
    }
  });
});

describe('localities (ADR 0017)', () => {
  it('are loaded once from the versioned GeoNames file, read only for the application', async () => {
    const { rows } = await owner.query<{ count: number; sha256: string; rows: number }>(
      `select (select count(*)::int from locality) as count, d.sha256, d.rows
       from dataset d where d.name = 'localities'`,
    );
    expect(rows[0]!.sha256).toBe(LOCALITIES_SHA256);
    expect(rows[0]!.count).toBe(rows[0]!.rows);
    expect(rows[0]!.count).toBeGreaterThan(2500);
    const { rows: mechelen } = await app.query<{ names: string[]; postal_codes: string[] }>(
      "select names, postal_codes from locality where name = 'Mechelen'",
    );
    expect(mechelen[0]!.names).toContain('Malines');
    expect(mechelen[0]!.postal_codes).toContain('2800');
    await expect(app.query("delete from locality where name = 'Mechelen'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      app.query("update dataset set sha256 = 'x' where name = 'localities'"),
    ).rejects.toThrow(/permission denied/);
    // Same file: nothing to load again.
    const folder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
    expect(await loadLocalities(owner, folder)).toEqual({ loaded: false, rows: 0 });
  });

  it('refuse a file that does not match its fingerprint (threat 8)', async () => {
    const folder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
    const altered = await mkdtemp(join(tmpdir(), 'job4me-localities-'));
    try {
      await mkdir(join(altered, 'data'));
      const text = await readFile(join(folder, 'data', 'localities.tsv'), 'utf8');
      // Brussels moved 40 km away.
      await writeFile(
        join(altered, 'data', 'localities.tsv'),
        text.replace('\t50.85040\t4.34880\t', '\t50.50000\t4.34880\t'),
      );
      await expect(loadLocalities(owner, altered)).rejects.toThrow(/fingerprint/);
    } finally {
      await rm(altered, { recursive: true, force: true });
    }
  });
});
