import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = join(ROOT, '.env');

/** `pnpm dev`: PostgreSQL with its port on 127.0.0.1, and Mailpit. */
export const COMPOSE = [
  'compose',
  '--env-file',
  ENV_FILE,
  '-f',
  join(ROOT, 'infra', 'compose.yaml'),
  '-f',
  join(ROOT, 'infra', 'compose.dev.yaml'),
];

/** `pnpm stack:*`: the whole application in containers, as on the home machine (profile app). */
export const STACK_COMPOSE = [
  'compose',
  '--env-file',
  ENV_FILE,
  '-f',
  join(ROOT, 'infra', 'compose.yaml'),
  '--profile',
  'app',
];

/** Reads KEY=VALUE lines of the .env written by `pnpm setup:*` (no expansion, no quotes). */
export function readEnvFile(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]!] = match[2]!;
  }
  return values;
}

/** Runs a command with inherited output; rejects when it fails. */
export function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...options.env },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? `exit ${code}`})`));
    });
  });
}
