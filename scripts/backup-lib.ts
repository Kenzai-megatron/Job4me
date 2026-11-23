import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readEnvFile, STACK_COMPOSE } from './lib';

// Encrypted backups (plan, section 9; ADR 0012): shared by `pnpm stack:backup` and
// `pnpm stack:restore-test`. PostgreSQL is reached through `docker compose exec` (its port is
// never published on the home machine); age encrypts for a public key, the private one lives in
// Mehdi's password manager.

export const OWNER = 'job4me_owner';
export const DATABASE = 'job4me';
const NAME = /^job4me-(\d{8}-\d{6})\.manifest\.json$/;

export interface Manifest {
  createdAt: string;
  database: { file: string; sha256: string; migrations: number; rows: Record<string, number> };
  files: { file: string; sha256: string; entries: number };
}

export function env(): Record<string, string> {
  return readEnvFile();
}

export function backupDir(values = env()): string {
  return values.JOB4ME_BACKUP_DIR ?? join(ROOT, 'var', 'backups');
}

export function filesDir(values = env()): string {
  return values.JOB4ME_FILES_DIR ?? join(ROOT, 'var', 'files');
}

/** `docker compose exec -T postgres …` as the owner, on the stack's own network. */
export function inPostgres(args: string[]): [string, string[]] {
  return ['docker', [...STACK_COMPOSE, 'exec', '-T', 'postgres', ...args]];
}

/** Waits for a process; rejects with its name when it fails. */
export function finished(child: ChildProcess, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${label} failed (${signal ?? `exit ${code}`})`)),
    );
  });
}

/** Runs `producer | consumer`, both with stderr shown, and waits for both. */
export async function pipe(
  producer: [string, string[]],
  consumer: [string, string[]],
  labels: [string, string],
): Promise<void> {
  const left = spawn(producer[0], producer[1], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  const right = spawn(consumer[0], consumer[1], {
    cwd: ROOT,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  left.stdout.pipe(right.stdin);
  await Promise.all([finished(left, labels[0]), finished(right, labels[1])]);
}

/** Runs a command and returns its standard output. */
export function output(command: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
    let text = '';
    child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve(text)
        : reject(new Error(`${command} ${args[0] ?? ''} failed (exit ${code})`)),
    );
    child.stdin.end(input ?? '');
  });
}

export async function requireAge(): Promise<void> {
  try {
    await output('age', ['--version']);
  } catch {
    throw new Error('age is missing: sudo apt install age (ADR 0012)');
  }
}

/**
 * Exact row counts of every table, as SQL. Run in the snapshot of the dump, they describe what
 * the dump holds, so the restore test can compare them one by one.
 */
export const COUNT_ROWS = `select table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name;`;

export const COUNT_MIGRATIONS = 'select count(*) from drizzle.__drizzle_migrations;';

export function parseCounts(text: string): Record<string, number> {
  const rows: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const match = /^([a-z0-9_]+)=(\d+)$/.exec(line.trim());
    if (match) rows[match[1]!] = Number(match[2]);
  }
  return rows;
}

/**
 * A psql session kept open: commands are written one at a time and each answer ends at a marker,
 * so a snapshot can stay open while pg_dump reads it.
 */
export class PsqlSession {
  private readonly child;
  private buffer = '';
  private waiting: ((text: string) => void) | null = null;
  private count = 0;

  constructor(database: string) {
    const [command, args] = inPostgres([
      'psql',
      '-X',
      '-q',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      OWNER,
      '-d',
      database,
    ]);
    this.child = spawn(command, args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      this.flush();
    });
  }

  private flush() {
    const marker = `__job4me_${this.count}__`;
    const end = this.buffer.indexOf(`${marker}\n`);
    if (end === -1 || !this.waiting) return;
    const text = this.buffer.slice(0, end);
    this.buffer = this.buffer.slice(end + marker.length + 1);
    const done = this.waiting;
    this.waiting = null;
    done(text);
  }

  /** Sends SQL and resolves with what psql printed for it. */
  run(sql: string): Promise<string> {
    this.count += 1;
    const marker = `__job4me_${this.count}__`;
    return new Promise((resolve, reject) => {
      this.waiting = resolve;
      this.child.once('exit', (code) => reject(new Error(`psql stopped (exit ${code})`)));
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`);
      this.flush();
    });
  }

  async close(): Promise<void> {
    this.child.stdin.end('\\q\n');
    await finished(this.child, 'psql');
  }
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Backups present in the folder, newest first, by the timestamp of their manifest. */
export function listBackups(dir: string): { stamp: string; manifest: Manifest }[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => NAME.exec(name)?.[1])
    .filter((stamp): stamp is string => stamp !== undefined)
    .sort()
    .reverse()
    .map((stamp) => ({
      stamp,
      manifest: JSON.parse(
        readFileSync(join(dir, `job4me-${stamp}.manifest.json`), 'utf8'),
      ) as Manifest,
    }));
}

export function stampOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

/** Monday-based week of a timestamp, to keep one backup a week. */
export function weekOf(stamp: string): string {
  const date = new Date(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T00:00:00Z`);
  const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

/** What the retention keeps: the newest `daily`, then the newest of each of `weekly` weeks. */
export function toKeep(stamps: string[], daily: number, weekly: number): Set<string> {
  const sorted = [...stamps].sort().reverse();
  const keep = new Set(sorted.slice(0, daily));
  const weeks = new Set<string>();
  for (const stamp of sorted.slice(daily)) {
    const week = weekOf(stamp);
    if (weeks.has(week) || weeks.size >= weekly) continue;
    weeks.add(week);
    keep.add(stamp);
  }
  return keep;
}
