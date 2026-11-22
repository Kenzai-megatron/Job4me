import type { Config } from '@job4me/config';
import type { Database } from '@job4me/db';
import type { Logger } from '@job4me/logger';
import { deriveKey, parseMasterKey } from '@job4me/security';

/** Keys derived from the master key, one per purpose (ADR 0004). */
export interface Keys {
  totp: Buffer;
  recovery: Buffer;
  csrf: Buffer;
  identity: Buffer;
}

export function deriveKeys(masterKeyBase64: string): Keys {
  const master = parseMasterKey(masterKeyBase64);
  return {
    totp: deriveKey(master, 'totp'),
    recovery: deriveKey(master, 'recovery'),
    csrf: deriveKey(master, 'csrf'),
    identity: deriveKey(master, 'identity'),
  };
}

/** Background jobs the API asks the worker to run (pg-boss). */
export interface JobQueue {
  send(name: string, data: Record<string, unknown>): Promise<string | null>;
}

/** Imported files (ADR 0010): their own key, apart from the master key, and the files volume. */
export interface ImportStore {
  key: Buffer;
  filesDir: string;
}

export interface AppDeps {
  config: Config;
  db: Database;
  keys: Keys;
  imports: ImportStore;
  logger: Logger;
  queue?: JobQueue;
  vapidPublicKey?: string;
  /** Built interface to serve (apps/web/dist); omitted in development. */
  webDistDir?: string;
  /** Injectable clock for tests. */
  now?: () => Date;
}
