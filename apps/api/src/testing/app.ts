import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '@job4me/config';
import { connect } from '@job4me/db';
import { createTestDatabase } from '@job4me/db/testing';
import { createLogger } from '@job4me/logger';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { type BuildOptions, buildApp } from '../app';
import { type AppDeps, deriveKeys } from '../context';

export interface TestAppOptions extends BuildOptions {
  webDistDir?: string;
  now?: () => Date;
  queue?: AppDeps['queue'];
}

/** A fully wired API on a throwaway, migrated database (integration tests only). */
export async function createTestApp(options: TestAppOptions = {}) {
  process.env.JOB4ME_ENV = 'test';
  const database = await createTestDatabase('api');
  const config = loadConfig();
  const handle = connect(database.appUrl, { max: 5 });
  const filesDir = mkdtempSync(join(tmpdir(), 'job4me-files-'));
  const deps: AppDeps = {
    config,
    db: handle.db,
    keys: deriveKeys(randomBytes(32).toString('base64')),
    imports: { key: randomBytes(32), filesDir },
    logger: createLogger({ name: 'test', level: 'silent' }),
    vapidPublicKey: 'BPublicKeyForTests',
    ...(options.webDistDir ? { webDistDir: options.webDistDir } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.queue ? { queue: options.queue } : {}),
  };
  const app = await buildApp(deps, options);
  await app.ready();
  return {
    app,
    deps,
    database,
    origin: config.settings.app.publicOrigin,
    close: async () => {
      await app.close();
      await handle.close();
      await database.drop();
      rmSync(filesDir, { recursive: true, force: true });
    },
  };
}

type Inject = (options: InjectOptions) => Promise<LightMyRequestResponse>;

/** A browser-like client: keeps cookies, sends the Origin and the CSRF token. */
export class TestBrowser {
  readonly cookies: Record<string, string> = {};
  csrfToken = '';

  constructor(
    private readonly inject: Inject,
    private readonly origin: string,
  ) {}

  private remember(response: LightMyRequestResponse) {
    for (const cookie of response.cookies as { name: string; value: string; maxAge?: number }[]) {
      if (cookie.maxAge === 0 || cookie.value === '') delete this.cookies[cookie.name];
      else this.cookies[cookie.name] = cookie.value;
    }
  }

  /** Loads the session state, as the interface does on start. */
  async refresh() {
    const response = await this.get('/api/auth/session');
    this.csrfToken = response.json<{ csrfToken: string }>().csrfToken;
    return response;
  }

  async get(url: string) {
    const response = await this.inject({ method: 'GET', url, cookies: this.cookies });
    this.remember(response);
    return response;
  }

  async send(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
    const response = await this.inject({
      method,
      url,
      cookies: this.cookies,
      headers: {
        origin: this.origin,
        'x-csrf-token': this.csrfToken,
        'sec-fetch-site': 'same-origin',
      },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    this.remember(response);
    return response;
  }

  post(url: string, payload?: unknown) {
    return this.send('POST', url, payload ?? {});
  }

  /** Sends files as a browser form does (multipart/form-data), with the same CSRF headers. */
  async upload(
    url: string,
    parts: { name: string; filename?: string; type?: string; content: Buffer | string }[],
    headers: Record<string, string> = {},
  ) {
    const boundary = `----job4me${Date.now()}`;
    const chunks: Buffer[] = [];
    for (const part of parts) {
      const disposition = part.filename
        ? `form-data; name="${part.name}"; filename="${part.filename}"`
        : `form-data; name="${part.name}"`;
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: ${disposition}\r\n` +
            `Content-Type: ${part.type ?? 'application/octet-stream'}\r\n\r\n`,
        ),
        Buffer.isBuffer(part.content) ? part.content : Buffer.from(part.content),
        Buffer.from('\r\n'),
      );
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const response = await this.inject({
      method: 'POST',
      url,
      cookies: this.cookies,
      headers: {
        origin: this.origin,
        'x-csrf-token': this.csrfToken,
        'sec-fetch-site': 'same-origin',
        'content-type': `multipart/form-data; boundary=${boundary}`,
        ...headers,
      },
      payload: Buffer.concat(chunks),
    });
    this.remember(response);
    return response;
  }
}
