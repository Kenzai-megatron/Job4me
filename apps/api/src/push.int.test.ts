import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint } from './modules/push/routes';
import { createUser, issueEnrollmentToken } from './modules/auth/users';
import { createTestApp, TestBrowser } from './testing/app';
import { SoftwareAuthenticator } from './testing/authenticator';

const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp({
    queue: {
      send: async (name, data) => {
        sent.push({ name, data });
        return 'job-id';
      },
    },
  });
});

afterAll(async () => {
  await ctx?.close();
});

async function signedInBrowser() {
  const settings = ctx.deps.config.settings;
  const user = await createUser(ctx.deps.db, {
    email: `push${Date.now()}@example.org`,
    displayName: 'Push',
    password: 'une phrase de passe pour les tests', // gitleaks:allow (test value)
    settings,
  });
  const { token } = await issueEnrollmentToken(ctx.deps.db, {
    userId: user.id,
    now: new Date(),
    validityMs: 60_000,
  });
  const browser = new TestBrowser((options) => ctx.app.inject(options), ctx.origin);
  await browser.refresh();
  const authenticator = new SoftwareAuthenticator({ rpId: settings.app.rpId, origin: ctx.origin });
  const { options } = (await browser.post('/api/auth/enroll/options', { token })).json<{
    options: Record<string, unknown>;
  }>();
  const verify = await browser.post('/api/auth/enroll/verify', {
    token,
    response: authenticator.register(options),
  });
  browser.csrfToken = verify.json<{ csrfToken: string }>().csrfToken;
  return { browser, user };
}

const keys = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };

describe('push endpoints accepted (no request to arbitrary hosts)', () => {
  it('accepts the push services of the supported browsers', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QGx')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(
      true,
    );
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
  });

  it('refuses internal or foreign addresses', () => {
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://user:pass@web.push.apple.com/x')).toBe(false);
  });
});

describe('push API', () => {
  it('needs a session', async () => {
    expect((await ctx.app.inject({ url: '/api/push/public-key' })).statusCode).toBe(401);
  });

  it('stores a subscription, refuses a forged endpoint and queues the test', async () => {
    const { browser, user } = await signedInBrowser();
    const key = await browser.get('/api/push/public-key');
    expect(key.json()).toEqual({ publicKey: 'BPublicKeyForTests' });

    const forged = await browser.post('/api/push/subscriptions', {
      endpoint: 'https://internal.example.org/hook',
      keys,
    });
    expect(forged.statusCode).toBe(400);

    const stored = await browser.post('/api/push/subscriptions', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
      keys,
    });
    expect(stored.statusCode).toBe(200);
    expect((await browser.get('/api/push/subscriptions')).json()).toEqual({ devices: 1 });

    expect((await browser.post('/api/push/test')).statusCode).toBe(200);
    expect(sent.at(-1)).toMatchObject({ name: 'push_test', data: { userId: user.id } });
  });

  it('caps test notifications per minute (configuration)', async () => {
    const { browser } = await signedInBrowser();
    // The previous test already used one request of this minute's budget for the test route.
    const budget = ctx.deps.config.settings.push.testRequestsPerMinute;
    const statuses: number[] = [];
    for (let request = 0; request <= budget; request++) {
      statuses.push((await browser.post('/api/push/test')).statusCode);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});
