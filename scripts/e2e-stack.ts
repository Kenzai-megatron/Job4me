import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEnvFile, ROOT, run, STACK_COMPOSE } from './lib';

// `pnpm test:e2e:stack`: the end-to-end specs against the containers started by `pnpm stack:up`
// (production mode, as on the home machine). Development stacks only: it creates a test account.

const STATE_FILE = join(ROOT, 'tests', 'e2e', '.state', 'e2e.json');

/** Runs a command with `input` on standard input and returns its standard output. */
function capture(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} failed (exit ${code})`)),
    );
    child.stdin.end(input);
  });
}

async function main(): Promise<void> {
  const env = readEnvFile();
  if (env.JOB4ME_ENV === 'production') {
    throw new Error('test:e2e:stack creates a test account: never on the home machine.');
  }
  const origin = `http://localhost:${env.JOB4ME_HTTP_PORT ?? '3000'}`;
  const password = randomBytes(18).toString('base64url');
  /** Creates an account through the CLI in the API container and returns its link. */
  const createAccount = async (email: string) => {
    const output = await capture(
      'docker',
      [
        ...STACK_COMPOSE,
        'exec',
        '-T',
        'api',
        'node',
        'api/cli.js',
        'user:create',
        '--email',
        email,
        '--name',
        'Mehdi',
      ],
      `${password}\n`,
    );
    const link = /https?:\/\/\S+\/enroll#\S+/.exec(output)?.[0];
    if (!link) throw new Error('user:create printed no enrollment link');
    return link;
  };
  const suffix = randomBytes(4).toString('hex');
  const email = `e2e-${suffix}@example.org`;
  const link = await createAccount(email);
  const profileLink = await createAccount(`e2e-profile-${suffix}@example.org`);
  mkdirSync(join(ROOT, 'tests', 'e2e', '.state'), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ link, email, password, profileLink }), {
    mode: 0o600,
  });
  await run('pnpm', ['--filter', '@job4me/e2e', 'test:e2e'], { env: { E2E_BASE_URL: origin } });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
