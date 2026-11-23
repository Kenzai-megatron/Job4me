import { setTimeout as delay } from 'node:timers/promises';
import type { Settings } from '@job4me/config';
import { type Logger, maskUrl } from '@job4me/logger';
import type { ZodType } from 'zod';
import { CollectError } from './errors';

// The only HTTP client of the collection (ADR 0014; Semgrep rule job4me-no-direct-http): hosts
// declared by the connector, checked before every request and at every redirect; ordinary
// browser headers; a pause between two requests; bounded time and size; 403 and 429 stop the
// source at once; keys masked in every log line. It never runs a page's JavaScript, never
// rotates addresses and never sends a cookie or an authorization header.

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type Sleep = (ms: number, signal: AbortSignal) => Promise<unknown>;

export interface PoliteClientOptions {
  source: string;
  /** Exact host names the source may reach, over HTTPS only. */
  hosts: readonly string[];
  pauseMs: number;
  /** Extra attempts after a network error, a timeout or a 5xx; never after a 4xx. */
  retries: number;
  http: Settings['collect']['http'];
  /** The source's budget: once aborted, nothing more is sent. */
  signal: AbortSignal;
  log?: Logger;
  /** Tests replace the network. */
  fetch?: FetchLike;
  sleep?: Sleep;
}

export interface RequestOptions {
  /** Extra headers, such as Content-Type; credentials and identity headers are refused. */
  headers?: Record<string, string>;
  accept?: string;
}

export interface PoliteResponse {
  status: number;
  /** Where the content came from, after redirects. */
  url: string;
  headers: Headers;
  text: string;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Never imitated nor sent: no session, no credentials, no identity other than the browser's. */
const FORBIDDEN_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'user-agent',
  'host',
  'accept-language',
]);
const HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const JSON_ACCEPT = 'application/json, text/plain;q=0.9, */*;q=0.8';

function decode(bytes: Uint8Array, contentType: string | null): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Parses JSON and checks its shape: an unexpected answer is an invalid response, never a crash. */
export function parseJson<T>(text: string, schema: ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CollectError('invalid_response');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CollectError('invalid_response');
  return parsed.data;
}

export class PoliteClient {
  /** Requests sent, redirects included: stored with the run. */
  requestCount = 0;
  private lastEnd = 0;
  private readonly hosts: ReadonlySet<string>;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: Sleep;

  constructor(private readonly options: PoliteClientOptions) {
    this.hosts = new Set(options.hosts.map((host) => host.toLowerCase()));
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  }

  getText(url: string, options: RequestOptions = {}): Promise<PoliteResponse> {
    return this.request(url, 'GET', undefined, { accept: HTML, ...options });
  }

  async getJson<T>(url: string, schema: ZodType<T>, options: RequestOptions = {}): Promise<T> {
    const response = await this.request(url, 'GET', undefined, { accept: JSON_ACCEPT, ...options });
    return parseJson(response.text, schema);
  }

  async postJson<T>(
    url: string,
    body: unknown,
    schema: ZodType<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await this.request(url, 'POST', JSON.stringify(body), {
      accept: JSON_ACCEPT,
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    return parseJson(response.text, schema);
  }

  /** One logical request: its redirects, and its retries when the source allows them. */
  async request(
    url: string,
    method: 'GET' | 'POST',
    body: string | undefined,
    options: RequestOptions,
  ): Promise<PoliteResponse> {
    const headers = this.headers(options);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.follow(url, method, body, headers);
      } catch (error) {
        const failure = error instanceof CollectError ? error : new CollectError('network_error');
        const retryable =
          failure.code === 'network_error' ||
          failure.code === 'timeout' ||
          (failure.code === 'http_error' && (failure.httpStatus ?? 0) >= 500);
        if (!retryable || attempt >= this.options.retries) throw failure;
        await this.wait(this.options.http.retryBaseMs * 2 ** attempt);
      }
    }
  }

  private headers(options: RequestOptions): Record<string, string> {
    for (const name of Object.keys(options.headers ?? {})) {
      if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
        throw new Error(`header ${name} may not be set by a connector`);
      }
    }
    return {
      'User-Agent': this.options.http.userAgent,
      Accept: options.accept ?? HTML,
      'Accept-Language': this.options.http.acceptLanguage,
      ...options.headers,
    };
  }

  /** Only HTTPS, only the declared hosts, on their default port, without credentials. */
  private check(input: string): URL {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new CollectError('host_not_allowed');
    }
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      !this.hosts.has(url.hostname)
    ) {
      throw new CollectError('host_not_allowed');
    }
    return url;
  }

  private async follow(
    input: string,
    initialMethod: 'GET' | 'POST',
    initialBody: string | undefined,
    headers: Record<string, string>,
  ): Promise<PoliteResponse> {
    let url = this.check(input);
    let method = initialMethod;
    let body = initialBody;
    for (let hop = 0; ; hop += 1) {
      const result = await this.exchange(url, method, body, headers);
      if (result.location === null) return result.response;
      if (hop >= this.options.http.maxRedirects) {
        throw new CollectError('http_error', result.response.status);
      }
      // Every hop is checked again: a redirect never leads outside the declared hosts.
      url = this.check(new URL(result.location, url).href);
      if (result.response.status === 303 || method === 'POST') {
        method = 'GET';
        body = undefined;
      }
    }
  }

  /** Sends one request after the pause and reads its answer within the time and size bounds. */
  private async exchange(
    url: URL,
    method: 'GET' | 'POST',
    body: string | undefined,
    headers: Record<string, string>,
  ): Promise<{ response: PoliteResponse; location: string | null }> {
    await this.wait(this.lastEnd === 0 ? 0 : this.lastEnd + this.options.pauseMs - Date.now());
    const timeout = AbortSignal.timeout(this.options.http.timeoutMs);
    const signal = AbortSignal.any([this.options.signal, timeout]);
    const started = Date.now();
    this.requestCount += 1;
    let status = 0;
    try {
      const response = await this.fetchImpl(url.href, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal,
      });
      status = response.status;
      if (REDIRECTS.has(status)) {
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get('location');
        if (!location) throw new CollectError('http_error', status);
        return { response: this.result(url, response, ''), location };
      }
      if (status === 403 || status === 429) {
        await response.body?.cancel().catch(() => undefined);
        throw new CollectError('blocked', status);
      }
      if (status < 200 || status > 299) {
        await response.body?.cancel().catch(() => undefined);
        throw new CollectError('http_error', status);
      }
      const text = await this.read(response);
      return { response: this.result(url, response, text), location: null };
    } catch (error) {
      if (error instanceof CollectError) throw error;
      if (this.options.signal.aborted) throw new CollectError('budget_exceeded');
      if (timeout.aborted) throw new CollectError('timeout');
      throw new CollectError('network_error');
    } finally {
      this.lastEnd = Date.now();
      this.options.log?.debug(
        {
          source: this.options.source,
          method,
          url: maskUrl(url.href),
          status,
          ms: this.lastEnd - started,
        },
        'collect request',
      );
    }
  }

  private result(url: URL, response: Response, text: string): PoliteResponse {
    return { status: response.status, url: url.href, headers: response.headers, text };
  }

  /** Reads the body up to the size bound; compressed answers are bounded once inflated. */
  private async read(response: Response): Promise<string> {
    const max = this.options.http.maxResponseBytes;
    const declared = Number(response.headers.get('content-length') ?? Number.NaN);
    if (Number.isFinite(declared) && declared > max) {
      await response.body?.cancel().catch(() => undefined);
      throw new CollectError('too_large');
    }
    if (!response.body) return '';
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        throw new CollectError('too_large');
      }
      chunks.push(value);
    }
    return decode(Buffer.concat(chunks), response.headers.get('content-type'));
  }

  private async wait(ms: number): Promise<void> {
    if (this.options.signal.aborted) throw new CollectError('budget_exceeded');
    if (ms <= 0) return;
    try {
      await this.sleep(ms, this.options.signal);
    } catch {
      throw new CollectError('budget_exceeded');
    }
  }
}
