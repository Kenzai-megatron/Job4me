import { createUser, issueEnrollmentToken } from '../modules/auth/users';
import type { createTestApp } from './app';
import { TestBrowser } from './app';
import { SoftwareAuthenticator } from './authenticator';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** A new account, enrolled with a software passkey: a signed-in browser (tests only). */
export async function signedInBrowser(ctx: TestApp, label: string) {
  const settings = ctx.deps.config.settings;
  const user = await createUser(ctx.deps.db, {
    email: `${label}-${Date.now()}-${Math.round(performance.now())}@example.org`,
    displayName: label,
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
  return { browser, userId: user.id };
}
