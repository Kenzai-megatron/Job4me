import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './lib';

// `pnpm check:compose` (CI security job, threat model rows 14 and 16): every published port stays
// on this machine, the application containers are hardened, the database stays on the internal
// network, and third-party images are pinned by digest. The isolated extractor (ADR 0010) gets
// no Internet, no master key, read-only files and bounded resources. Reads Compose's own model.

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
  volumes?: { source?: string; target: string; read_only?: boolean }[];
  networks?: Record<string, unknown>;
  secrets?: { source: string }[];
  mem_limit?: string | number;
  pids_limit?: number;
}
interface Model {
  services: Record<string, Service>;
  networks?: Record<string, { internal?: boolean }>;
}

const APP_SERVICES = ['migrate', 'api', 'worker', 'extract'];
const EXTRACTOR_SECRETS = ['db_extractor_password', 'import_key'];
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

/** The Claude API key reaches the worker and nothing else (ADR 0009). */
function checkAiKey(name: string, model: Model): string[] {
  return Object.entries(model.services)
    .filter(
      ([service, spec]) =>
        service !== 'worker' &&
        (spec.secrets ?? []).some((secret) => secret.source === 'anthropic_api_key'),
    )
    .map(([service]) => `${name}/${service}: must not receive the Claude API key`);
}

function checkExtractor(name: string, model: Model): string[] {
  const spec = model.services.extract;
  if (!spec) return [`${name}: no extract service`];
  const where = `${name}/extract`;
  const problems: string[] = [];
  if (Object.keys(spec.networks ?? {}).join() !== 'internal') {
    problems.push(`${where}: must only join the internal network (no Internet)`);
  }
  if ((spec.ports ?? []).length > 0) problems.push(`${where}: publishes a port`);
  const secrets = (spec.secrets ?? []).map((secret) => secret.source).sort();
  if (secrets.join() !== EXTRACTOR_SECRETS.join()) {
    problems.push(
      `${where}: secrets must be ${EXTRACTOR_SECRETS.join(' and ')}, not ${secrets.join(', ')}`,
    );
  }
  if ((spec.volumes ?? []).some((volume) => volume.read_only !== true)) {
    problems.push(`${where}: every mount must be read-only`);
  }
  if (!spec.mem_limit) problems.push(`${where}: no memory limit`);
  if (!spec.pids_limit) problems.push(`${where}: no process limit`);
  return problems;
}

async function main(): Promise<void> {
  const home = await resolve(['compose.yaml'], ['app']);
  const dev = await resolve(['compose.yaml', 'compose.dev.yaml'], ['app']);
  const problems = [
    ...check('home', home),
    ...check('dev', dev),
    ...checkExtractor('home', home),
    ...checkExtractor('dev', dev),
    ...checkAiKey('home', home),
    ...checkAiKey('dev', dev),
  ];
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
