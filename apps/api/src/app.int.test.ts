import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schema } from '@job4me/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { recordAudit } from '@job4me/db';
import { createTestApp, TestBrowser } from './testing/app';

// Test-only routes to exercise the shared plumbing (CSRF, validation, errors).
const testRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/api/test/echo',
    { schema: { body: z.object({ value: z.string().max(10) }) } },
    (request) => ({ value: request.body.value }),
  );
  app.get('/api/test/crash', () => {
    throw new Error('database password is hunter2');
  });
};

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let webDir: string;

beforeAll(async () => {
  webDir = mkdtempSync(join(tmpdir(), 'job4me-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Job4me</title>');
  writeFileSync(join(webDir, 'assets', 'app-abc123.js'), 'console.log(1)');
  ctx = await createTestApp({
    webDistDir: webDir,
    extraRoutes: testRoutes,
  });
});

afterAll(async () => {
  await ctx?.close();
});

const browser = () => new TestBrowser((options) => ctx.app.inject(options), ctx.origin);

describe('health', () => {
  it('answers liveness and readiness', async () => {
    expect((await ctx.app.inject({ url: '/api/health' })).json()).toEqual({ status: 'ok' });
    const ready = await ctx.app.inject({ url: '/api/ready' });
    expect(ready.statusCode).toBe(200);
  });

  it('returns a request id on every response', async () => {
    const response = await ctx.app.inject({ url: '/api/health' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('security headers (threat model rows 6 and 15)', () => {
  it('sends a strict CSP without inline scripts and forbids framing', async () => {
    const response = await ctx.app.inject({ url: '/api/health' });
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(String(response.headers['permissions-policy'])).toContain('camera=()');
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('CSRF (threat model row 5)', () => {
  it('rejects a state-changing request without Origin', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/test/echo',
      payload: { value: 'x' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'csrf_failed' });
  });

  it('rejects another origin', async () => {
    const client = browser();
    await client.refresh();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/test/echo',
      cookies: client.cookies,
      headers: { origin: 'https://evil.example', 'x-csrf-token': client.csrfToken },
      payload: { value: 'x' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a missing or foreign token', async () => {
    const client = browser();
    await client.refresh();
    const other = browser();
    await other.refresh();
    client.csrfToken = other.csrfToken;
    expect((await client.post('/api/test/echo', { value: 'x' })).statusCode).toBe(403);
    client.csrfToken = '';
    expect((await client.post('/api/test/echo', { value: 'x' })).statusCode).toBe(403);
  });

  it('rejects a cross-site fetch even with a token', async () => {
    const client = browser();
    await client.refresh();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/test/echo',
      cookies: client.cookies,
      headers: {
        origin: ctx.origin,
        'x-csrf-token': client.csrfToken,
        'sec-fetch-site': 'cross-site',
      },
      payload: { value: 'x' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('accepts a same-origin request with the right token', async () => {
    const client = browser();
    await client.refresh();
    const response = await client.post('/api/test/echo', { value: 'hello' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ value: 'hello' });
  });

  it('issues the pre-login cookie with strict attributes', async () => {
    const response = await ctx.app.inject({ url: '/api/auth/session' });
    const cookie = (response.cookies as Array<Record<string, unknown>>).find(
      (c) => c.name === '__Host-j4m_pre',
    );
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
  });
});

describe('errors never leak internals (threat model row 15)', () => {
  it('answers 500 with a code and a request id only', async () => {
    const response = await ctx.app.inject({ url: '/api/test/crash' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('hunter2');
    const body = response.json<{ error: string; requestId: string }>();
    expect(body.error).toBe('internal_error');
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(body).sort()).toEqual(['error', 'requestId']);
  });

  it('answers 400 on invalid input without echoing it', async () => {
    const client = browser();
    await client.refresh();
    const response = await client.post('/api/test/echo', { value: 'far-too-long-value' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation_error' });
    expect(response.body).not.toContain('far-too-long-value');
  });

  it('refuses oversized bodies', async () => {
    const client = browser();
    await client.refresh();
    const response = await client.post('/api/test/echo', { value: 'x'.repeat(2_000_000) });
    expect(response.statusCode).toBe(413);
  });

  it('answers 404 in JSON for unknown API routes', async () => {
    const response = await ctx.app.inject({ url: '/api/nothing-here' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'not_found' });
  });
});

describe('static interface (ADR 0002)', () => {
  it('serves index.html with the CSP, and falls back to it for client routes', async () => {
    const home = await ctx.app.inject({ url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('<title>Job4me</title>');
    expect(home.headers['content-security-policy']).toBeDefined();
    const deepLink = await ctx.app.inject({ url: '/settings/security' });
    expect(deepLink.statusCode).toBe(200);
    expect(deepLink.headers['cache-control']).toBe('no-cache');
  });

  it('caches hashed assets for a year', async () => {
    const asset = await ctx.app.inject({ url: '/assets/app-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
  });

  it('never serves files outside the build folder', async () => {
    const response = await ctx.app.inject({ url: '/../package.json' });
    expect(response.body).not.toContain('"name"');
  });
});

describe('audit log', () => {
  it('records events without personal data', async () => {
    await recordAudit(ctx.deps.db, {
      actorType: 'system',
      action: 'test.recorded',
      outcome: 'success',
      metadata: { method: 'passkey' },
    });
    const rows = await ctx.deps.db.select().from(schema.auditLog);
    expect(rows.some((row) => row.action === 'test.recorded')).toBe(true);
  });
});
