import { Writable } from 'node:stream';
import { createLogger } from '@job4me/logger';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CollectError } from './errors';
import { type FetchLike, PoliteClient, type PoliteClientOptions } from './http';

const http = {
  userAgent: 'Mozilla/5.0 (test) Chrome/142.0.0.0',
  acceptLanguage: 'fr-BE,fr;q=0.9,nl;q=0.8,en;q=0.7',
  timeoutMs: 1000,
  maxResponseBytes: 1024,
  maxRedirects: 2,
  retryBaseMs: 10,
};

interface Call {
  url: string;
  init: RequestInit;
}

/** A fake network: each call takes the next answer of the script. */
function network(...answers: Array<Response | ((call: Call) => Promise<Response>)>) {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    const call = { url, init };
    calls.push(call);
    const answer = answers.shift();
    if (!answer) throw new Error('no answer left');
    return typeof answer === 'function' ? answer(call) : Promise.resolve(answer);
  };
  return { calls, fetch };
}

function client(fetch: FetchLike, options: Partial<PoliteClientOptions> = {}) {
  const waits: number[] = [];
  const polite = new PoliteClient({
    source: 'demo',
    hosts: ['jobs.example.org', 'api.example.org'],
    pauseMs: 3000,
    retries: 0,
    http,
    signal: new AbortController().signal,
    fetch,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    ...options,
  });
  return { polite, waits };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

async function failure(promise: Promise<unknown>): Promise<CollectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CollectError) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

describe('PoliteClient', () => {
  it('sends ordinary browser headers, never a cookie, and follows nothing by itself', async () => {
    const net = network(new Response('<html></html>'));
    const { polite } = client(net.fetch);
    const response = await polite.getText('https://jobs.example.org/search?q=comptable');
    expect(response.text).toBe('<html></html>');
    const headers = net.calls[0]!.init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(http.userAgent);
    expect(headers['Accept-Language']).toBe(http.acceptLanguage);
    expect(headers.Accept).toContain('text/html');
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('cookie');
    expect(net.calls[0]!.init.redirect).toBe('manual');
    expect(polite.requestCount).toBe(1);
  });

  it('refuses credential and identity headers from a connector', async () => {
    const { polite } = client(network().fetch);
    for (const name of ['Authorization', 'cookie', 'User-Agent', 'Accept-Language']) {
      await expect(
        polite.getText('https://jobs.example.org/', { headers: { [name]: 'x' } }),
      ).rejects.toThrow(/may not be set/);
    }
  });

  it('refuses hosts outside the list, plain http, other ports and credentials in the URL', async () => {
    const net = network();
    const { polite } = client(net.fetch);
    for (const url of [
      'https://evil.example.net/',
      'http://jobs.example.org/',
      'https://jobs.example.org:8443/',
      'https://user:secret@jobs.example.org/',
      'https://jobs.example.org.evil.net/',
      'not a url',
    ]) {
      expect((await failure(polite.getText(url))).code).toBe('host_not_allowed');
    }
    expect(net.calls).toHaveLength(0);
  });

  it('checks every redirect against the list (threat 1)', async () => {
    const net = network(
      new Response(null, { status: 302, headers: { location: '/page/2' } }),
      new Response(null, { status: 301, headers: { location: 'https://evil.example.net/' } }),
    );
    const { polite } = client(net.fetch);
    const error = await failure(polite.getText('https://jobs.example.org/page/1'));
    expect(error.code).toBe('host_not_allowed');
    expect(net.calls.map((call) => call.url)).toEqual([
      'https://jobs.example.org/page/1',
      'https://jobs.example.org/page/2',
    ]);
  });

  it('follows a redirect within the list, a bounded number of times', async () => {
    const hop = () => new Response(null, { status: 302, headers: { location: '/next' } });
    const ok = network(hop(), new Response('done'));
    expect((await client(ok.fetch).polite.getText('https://jobs.example.org/')).url).toBe(
      'https://jobs.example.org/next',
    );
    const loop = network(hop(), hop(), hop());
    const error = await failure(client(loop.fetch).polite.getText('https://jobs.example.org/'));
    expect(error).toMatchObject({ code: 'http_error', httpStatus: 302 });
    expect(loop.calls).toHaveLength(3);
  });

  it('stops at the first 403 or 429, without any retry (ADR 0014)', async () => {
    for (const status of [403, 429]) {
      const net = network(new Response('no', { status }));
      const { polite } = client(net.fetch, { retries: 3 });
      const error = await failure(polite.getText('https://jobs.example.org/'));
      expect(error).toMatchObject({ code: 'blocked', httpStatus: status, fatal: true });
      expect(net.calls).toHaveLength(1);
    }
  });

  it('retries a 5xx or a network error with a growing wait, never a 404', async () => {
    const flaky = network(
      new Response('down', { status: 503 }),
      () => Promise.reject(new TypeError('fetch failed')),
      json({ ok: true }),
    );
    const { polite, waits } = client(flaky.fetch, { retries: 2, pauseMs: 0 });
    await expect(
      polite.getJson('https://api.example.org/v1', z.object({ ok: z.boolean() })),
    ).resolves.toEqual({ ok: true });
    expect(waits).toEqual([10, 20]);

    const missing = network(new Response('gone', { status: 404 }));
    const error = await failure(
      client(missing.fetch, { retries: 2 }).polite.getText('https://jobs.example.org/x'),
    );
    expect(error).toMatchObject({ code: 'http_error', httpStatus: 404, fatal: false });
    expect(missing.calls).toHaveLength(1);
  });

  it('pauses between two requests of the same source', async () => {
    const net = network(new Response('1'), new Response('2'), new Response('3'));
    const { polite, waits } = client(net.fetch);
    await polite.getText('https://jobs.example.org/1');
    await polite.getText('https://jobs.example.org/2');
    await polite.getText('https://jobs.example.org/3');
    expect(waits).toHaveLength(2);
    for (const wait of waits) {
      expect(wait).toBeGreaterThan(2900);
      expect(wait).toBeLessThanOrEqual(3000);
    }
  });

  it('bounds the size of an answer, declared or streamed (threat 2)', async () => {
    const declared = network(
      new Response('x', { headers: { 'content-length': String(10 * 1024 * 1024) } }),
    );
    expect(
      (await failure(client(declared.fetch).polite.getText('https://jobs.example.org/'))).code,
    ).toBe('too_large');
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(512));
      },
    });
    const streamed = network(new Response(endless));
    expect(
      (await failure(client(streamed.fetch).polite.getText('https://jobs.example.org/'))).code,
    ).toBe('too_large');
    expect(pulled).toBeLessThan(10);
  });

  it('gives up after the timeout, and stops at once when the budget ends', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        if (init.signal?.aborted) reject(new DOMException('aborted'));
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted')));
      });
    const slow = client(hanging, { http: { ...http, timeoutMs: 30 } });
    expect((await failure(slow.polite.getText('https://jobs.example.org/'))).code).toBe('timeout');

    const budget = new AbortController();
    const net = network((call) => {
      budget.abort();
      return hanging(call.url, call.init);
    });
    const { polite } = client(net.fetch, { signal: budget.signal, retries: 3 });
    expect((await failure(polite.getText('https://jobs.example.org/'))).code).toBe(
      'budget_exceeded',
    );
    expect((await failure(polite.getText('https://jobs.example.org/'))).code).toBe(
      'budget_exceeded',
    );
    expect(net.calls).toHaveLength(1);
  });

  it('checks JSON against its schema, and never crashes on a malformed answer', async () => {
    const schema = z.object({ results: z.array(z.object({ id: z.string() })) });
    const good = network(json({ results: [{ id: 'a' }] }));
    await expect(
      client(good.fetch).polite.getJson('https://api.example.org/', schema),
    ).resolves.toEqual({
      results: [{ id: 'a' }],
    });
    for (const answer of [new Response('<html>'), json({ results: 'nope' })]) {
      const net = network(answer);
      expect(
        (await failure(client(net.fetch).polite.getJson('https://api.example.org/', schema))).code,
      ).toBe('invalid_response');
    }
  });

  it('posts JSON and turns a POST redirect into a GET', async () => {
    const net = network(
      new Response(null, { status: 303, headers: { location: '/results' } }),
      json({ total: 3 }),
    );
    const { polite } = client(net.fetch);
    await expect(
      polite.postJson(
        'https://api.example.org/search',
        { q: 'a' },
        z.object({ total: z.number() }),
      ),
    ).resolves.toEqual({ total: 3 });
    expect(net.calls[0]!.init).toMatchObject({ method: 'POST', body: '{"q":"a"}' });
    expect((net.calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(net.calls[1]!.init).toMatchObject({ method: 'GET', body: undefined });
  });

  it('decodes the charset the server declares', async () => {
    const latin1 = new Response(Buffer.from([0x63, 0x61, 0x66, 0xe9]), {
      headers: { 'content-type': 'text/html; charset=ISO-8859-1' },
    });
    const { polite } = client(network(latin1).fetch);
    expect((await polite.getText('https://jobs.example.org/')).text).toBe('café');
  });

  it('logs masked URLs only (threat 3)', async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString('utf8'));
        done();
      },
    });
    const log = createLogger({ name: 'test', level: 'debug', destination });
    const net = network(new Response('no', { status: 429 }));
    const { polite } = client(net.fetch, { log });
    const error = await failure(
      polite.getText('https://api.example.org/jobs?app_id=abc&app_key=s3cr3t-key&what=comptable'),
    );
    expect(error.message).not.toContain('s3cr3t');
    const logged = lines.join('');
    expect(logged).toContain('app_key=[redacted]');
    expect(logged).toContain('what=comptable');
    expect(logged).not.toContain('s3cr3t');
  });
});
