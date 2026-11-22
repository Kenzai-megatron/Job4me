import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = join(ROOT, '.env');

export const COMPOSE = [
  'compose',
  '--env-file',
  ENV_FILE,
  '-f',
  join(ROOT, 'infra', 'compose.yaml'),
  '-f',
  join(ROOT, 'infra', 'compose.dev.yaml'),
];

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
