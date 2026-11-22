import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import {
  type Config,
  type Environment,
  environmentSchema,
  MAILPIT_HOSTS,
  type Secrets,
  type Settings,
  settingsSchema,
} from './schema';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Env = Record<string, string | undefined>;

/** Finds the repository directory holding config/default.yaml, walking up from `start`. */
export function findConfigDir(start: string = process.cwd(), env: Env = process.env): string {
  const fromEnv = env.JOB4ME_CONFIG_DIR;
  if (fromEnv) {
    if (!existsSync(join(fromEnv, 'default.yaml'))) {
      throw new ConfigError(`JOB4ME_CONFIG_DIR has no default.yaml: ${fromEnv}`);
    }
    return resolve(fromEnv);
  }
  let current = resolve(start);
  for (;;) {
    const candidate = join(current, 'config', 'default.yaml');
    if (existsSync(candidate)) return dirname(candidate);
    const parent = dirname(current);
    if (parent === current) {
      throw new ConfigError('config/default.yaml not found; set JOB4ME_CONFIG_DIR');
    }
    current = parent;
  }
}

/** Loads the repository's .env file into `env` for development and tests (never overrides). */
export function loadDotEnv(configDir: string, env: Env = process.env): void {
  const file = join(dirname(configDir), '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match as unknown as [string, string, string];
    if (env[key] !== undefined) continue;
    env[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return override === undefined ? base : override;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = deepMerge(base[key], value);
  }
  return result;
}

function readYaml(file: string): unknown {
  try {
    return parse(readFileSync(file, 'utf8')) as unknown;
  } catch (error) {
    throw new ConfigError(`invalid YAML in ${file}: ${(error as Error).message}`);
  }
}

function intFromEnv(env: Env, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new ConfigError(`${name} must be an integer`);
  return value;
}

/** Environment variables that may override a setting on a given machine. */
function overridesFromEnv(env: Env): unknown {
  const listenPort = intFromEnv(env, 'JOB4ME_LISTEN_PORT');
  const smtpPort = intFromEnv(env, 'JOB4ME_SMTP_PORT');
  const pushContact = env.JOB4ME_PUSH_CONTACT;
  return {
    app: {
      ...(env.JOB4ME_PUBLIC_ORIGIN ? { publicOrigin: env.JOB4ME_PUBLIC_ORIGIN } : {}),
      ...(env.JOB4ME_RP_ID ? { rpId: env.JOB4ME_RP_ID } : {}),
      ...(env.JOB4ME_LISTEN_HOST ? { listenHost: env.JOB4ME_LISTEN_HOST } : {}),
      ...(listenPort !== undefined ? { listenPort } : {}),
    },
    mail: {
      ...(env.JOB4ME_SMTP_HOST ? { smtpHost: env.JOB4ME_SMTP_HOST } : {}),
      ...(smtpPort !== undefined ? { smtpPort } : {}),
    },
    push: {
      ...(pushContact ? { vapidSubject: pushContact } : {}),
    },
  };
}

function checkEnvironmentRules(env: Environment, settings: Settings): void {
  if (env !== 'production') {
    const host = settings.mail.smtpHost;
    if (!(MAILPIT_HOSTS as readonly string[]).includes(host) || settings.mail.smtpPort !== 1025) {
      throw new ConfigError(
        `in ${env}, mail must go to Mailpit (host ${MAILPIT_HOSTS.join(', ')}, port 1025), not ${host}:${settings.mail.smtpPort}`,
      );
    }
  }
  const { protocol, hostname } = new URL(settings.app.publicOrigin);
  const local = hostname === 'localhost' || hostname === '127.0.0.1';
  if (env === 'production' && protocol !== 'https:' && !local) {
    throw new ConfigError('in production, publicOrigin must use https');
  }
}

export interface LoadOptions {
  env?: Env;
  cwd?: string;
}

/** Loads config/default.yaml, then config/local.yaml, then environment overrides, and validates. */
export function loadConfig(options: LoadOptions = {}): Config {
  const env = options.env ?? process.env;
  const configDir = findConfigDir(options.cwd, env);
  const parsedEnv = environmentSchema.safeParse(env.JOB4ME_ENV ?? 'development');
  if (!parsedEnv.success) {
    throw new ConfigError('JOB4ME_ENV must be development, test or production');
  }
  const environment = parsedEnv.data;
  if (environment !== 'production') loadDotEnv(configDir, env);

  let raw = readYaml(join(configDir, 'default.yaml'));
  const localFile = join(configDir, 'local.yaml');
  if (existsSync(localFile)) raw = deepMerge(raw, readYaml(localFile));
  raw = deepMerge(raw, overridesFromEnv(env));

  const result = settingsSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  checkEnvironmentRules(environment, result.data);

  const allowedOrigins = [
    ...new Set([result.data.app.publicOrigin, ...result.data.app.extraOrigins]),
  ];
  return { env: environment, settings: result.data, allowedOrigins };
}

/** Reads a secret from NAME, or from the file named by NAME_FILE. */
export function readSecret(name: string, env: Env = process.env): string | undefined {
  const direct = env[name];
  if (direct) return direct.trim();
  const file = env[`${name}_FILE`];
  if (!file) return undefined;
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    throw new ConfigError(`cannot read ${name}_FILE`);
  }
}

function requireSecret(name: string, env: Env): string {
  const value = readSecret(name, env);
  if (!value) throw new ConfigError(`missing secret ${name} (or ${name}_FILE); run pnpm setup:dev`);
  return value;
}

/** Reads the secrets the application needs. Values are never logged. */
export function loadSecrets(env: Env = process.env): Secrets {
  return {
    databaseUrl: requireSecret('JOB4ME_DATABASE_URL', env),
    databaseOwnerUrl: readSecret('JOB4ME_DATABASE_OWNER_URL', env),
    masterKey: requireSecret('JOB4ME_MASTER_KEY', env),
    vapidPublicKey: readSecret('JOB4ME_VAPID_PUBLIC_KEY', env),
    vapidPrivateKey: readSecret('JOB4ME_VAPID_PRIVATE_KEY', env),
  };
}
