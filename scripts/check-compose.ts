import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './lib';

// `pnpm check:compose` (CI security job, threat model rows 14 and 16): every published port stays
// on this machine, the application containers are hardened, the database stays on the internal
// network, and third-party images are pinned by digest. Reads Compose's own resolved model.

interface Service {
  image?: string;
  user?: string;
  read_only?: boolean;
  cap_drop?: string[];
  security_opt?: string[];
  privileged?: boolean;
  network_mode?: string;
  pid?: string;
  ports?: { host_ip?: string; published?: string; target: number }[];
  volumes?: { source?: string; target: string }[];
  networks?: Record<string, unknown>;
}
interface Model {
  services: Record<string, Service>;
  networks?: Record<string, { internal?: boolean }>;
}

const APP_SERVICES = ['migrate', 'api', 'worker'];
const LOCAL_HOSTS = new Set(['127.0.0.1', '::1']);

function resolve(files: string[], profiles: string[]): Promise<Model> {
  const args = ['compose', '--env-file', join(ROOT, '.env.example')];
  for (const file of files) args.push('-f', join(ROOT, 'infra', file));
  for (const profile of profiles) args.push('--profile', profile);
  args.push('config', '--format', 'json');
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolvePromise(JSON.parse(output) as Model)
        : reject(new Error(`docker compose config failed (exit ${code})`)),
    );
  });
}

function check(name: string, model: Model): string[] {
  const problems: string[] = [];
  for (const [service, spec] of Object.entries(model.services)) {
    const where = `${name}/${service}`;
    for (const port of spec.ports ?? []) {
      if (!port.host_ip || !LOCAL_HOSTS.has(port.host_ip)) {
        problems.push(`${where}: port ${port.target} is published beyond 127.0.0.1`);
      }
    }
    if (!spec.security_opt?.includes('no-new-privileges:true')) {
      problems.push(`${where}: no-new-privileges is missing`);
    }
    if (spec.privileged) problems.push(`${where}: privileged container`);
    if (spec.network_mode === 'host' || spec.pid === 'host') {
      problems.push(`${where}: shares the host network or process namespace`);
    }
    if ((spec.volumes ?? []).some((volume) => volume.source?.includes('docker.sock'))) {
      problems.push(`${where}: mounts the Docker socket`);
    }
    if (spec.image && !spec.image.startsWith('job4me:') && !spec.image.includes('@sha256:')) {
      problems.push(`${where}: image ${spec.image} is not pinned by digest`);
    }
    if (APP_SERVICES.includes(service)) {
      if (spec.read_only !== true) problems.push(`${where}: root filesystem is writable`);
      if (!spec.cap_drop?.includes('ALL')) problems.push(`${where}: capabilities are not dropped`);
      const user = spec.user?.split(':')[0];
      if (!user || user === '0' || user === 'root') problems.push(`${where}: runs as root`);
    }
  }
  return problems;
}

async function main(): Promise<void> {
  const home = await resolve(['compose.yaml'], ['app']);
  const dev = await resolve(['compose.yaml', 'compose.dev.yaml'], ['app']);
  const problems = [...check('home', home), ...check('dev', dev)];
  const postgres = home.services.postgres;
  if (!postgres) problems.push('home: no postgres service');
  else if (Object.keys(postgres.networks ?? {}).join() !== 'internal') {
    problems.push('home/postgres: must only join the internal network');
  }
  if (home.networks?.internal?.internal !== true) {
    problems.push('home: the internal network must have no route outside');
  }
  if (problems.length > 0) {
    console.error(`Compose checks failed:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`Compose checks passed (${Object.keys(dev.services).length} services).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
