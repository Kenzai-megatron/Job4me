import { existsSync } from 'node:fs';
import { ENV_FILE, run, STACK_COMPOSE as COMPOSE } from './lib';

// `pnpm stack:*`: the whole application in containers, as on the home machine (profile app).

async function main() {
  const [command = 'up', ...rest] = process.argv.slice(2);
  if (!existsSync(ENV_FILE)) {
    throw new Error(
      '.env is missing: run `pnpm setup:home --origin https://…` (or setup:dev) first',
    );
  }
  switch (command) {
    case 'up':
      await run('docker', [...COMPOSE, 'up', '-d', '--build', '--wait']);
      console.log('Job4me runs on http://127.0.0.1:3000 (Tailscale serves it over HTTPS).');
      break;
    case 'down':
      await run('docker', [...COMPOSE, 'down']);
      break;
    case 'logs':
      await run('docker', [...COMPOSE, 'logs', '--tail', '200', ...rest]);
      break;
    case 'cli': {
      // Administration commands inside the API container: pnpm stack:cli user:create --email …
      // Without a terminal (a pipe, the CI), no TTY is requested so standard input still flows.
      const tty = process.stdin.isTTY ? [] : ['-T'];
      await run('docker', [...COMPOSE, 'exec', ...tty, 'api', 'node', 'api/cli.js', ...rest]);
      break;
    }
    default:
      throw new Error(`unknown command ${command}: up, down, logs or cli`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
