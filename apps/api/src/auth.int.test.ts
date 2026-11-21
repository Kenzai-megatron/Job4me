import { generateTotpCode } from '@job4me/security';
import { schema } from '@job4me/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, issueEnrollmentToken } from './modules/auth/users';
import { createTestApp, TestBrowser } from './testing/app';
import { SoftwareAuthenticator } from './testing/authenticator';

const PASSWORD = 'vélo rouge sous la pluie 2026';

// Test clock: starts now, moves forward on demand.
let current = new Date();
const advance = (ms: number) => {
  current = new Date(current.getTime() + ms);
};

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let counter = 0;

beforeAll(async () => {
  ctx = await createTestApp({ now: () => current });
});

afterAll(async () => {
  await ctx?.close();
});

const settings = () => ctx.deps.config.settings;
const newBrowser = () => new TestBrowser((options) => ctx.app.inject(options), ctx.origin);
const newAuthenticator = (options: { synced?: boolean; origin?: string } = {}) =>
  new SoftwareAuthenticator({
    rpId: settings().app.rpId,
    origin: options.origin ?? ctx.origin,
    ...(options.synced !== undefined ? { synced: options.synced } : {}),
  });

interface Options {
  options: Record<string, unknown>;
}

async function newUser() {
  counter += 1;
  const email = `user${counter}@example.org`;
  const user = await createUser(ctx.deps.db, {
    email,
    displayName: `User ${counter}`,
    password: PASSWORD,
    settings: settings(),
  });
  const { token } = await issueEnrollmentToken(ctx.deps.db, {
    userId: user.id,
    now: current,
    validityMs: settings().auth.enrollmentLinkMinutes * 60_000,
  });
  return { user, email, token };
}

/** Creates a user and completes the enrollment link with a passkey. */
async function enrolledUser(authenticatorOptions: { synced?: boolean } = {}) {
  const { user, email, token } = await newUser();
  const browser = newBrowser();
  await browser.refresh();
  const authenticator = newAuthenticator(authenticatorOptions);
  const { options } = (await browser.post('/api/auth/enroll/options', { token })).json<Options>();
  const verify = await browser.post('/api/auth/enroll/verify', {
    token,
    response: authenticator.register(options),
    name: 'Clé de test',
  });
  expect(verify.statusCode).toBe(200);
  browser.csrfToken = verify.json<{ csrfToken: string }>().csrfToken;
  return { user, email, token, browser, authenticator };
}

async function enableTotp(browser: TestBrowser): Promise<string> {
  const setup = (await browser.post('/api/auth/totp/setup')).json<{ secret: string }>();
  const confirm = await browser.post('/api/auth/totp/confirm', {
    code: generateTotpCode(setup.secret, current.getTime()),
  });
  expect(confirm.statusCode).toBe(200);
  return setup.secret;
}

async function passkeySignIn(browser: TestBrowser, authenticator: SoftwareAuthenticator) {
  await browser.refresh();
  const { options } = (await browser.post('/api/auth/passkey/options')).json<Options>();
  const response = await browser.post('/api/auth/passkey/verify', {
    response: authenticator.authenticate(options),
  });
  if (response.statusCode === 200) {
    browser.csrfToken = response.json<{ csrfToken: string }>().csrfToken;
  }
  return response;
}

async function auditActions(userId: string) {
  const rows = await ctx.deps.db.select().from(schema.auditLog);
  return rows.filter((row) => row.actorUserId === userId).map((row) => row.action);
}

describe('enrollment', () => {
  it('registers the first passkey and opens a session with a strict cookie', async () => {
    const { token } = await newUser();
    const browser = newBrowser();
    await browser.refresh();
    const authenticator = newAuthenticator();
    const { options } = (await browser.post('/api/auth/enroll/options', { token })).json<Options>();
    expect(options).toMatchObject({
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      attestation: 'none',
    });
    const verify = await browser.post('/api/auth/enroll/verify', {
      token,
      response: authenticator.register(options),
    });
    expect(verify.statusCode).toBe(200);
    const cookie = (verify.cookies as Array<Record<string, unknown>>).find(
      (c) => c.name === '__Host-j4m_session',
    );
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect(cookie?.domain).toBeUndefined();
    const state = (await browser.refresh()).json<{ authenticated: boolean }>();
    expect(state.authenticated).toBe(true);
  });

  it('cannot use the same link twice', async () => {
    const { token, browser } = await enrolledUser();
    const again = await browser.post('/api/auth/enroll/options', { token });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({ error: 'link_invalid' });
  });

  it('refuses an expired link', async () => {
    const { token } = await newUser();
    advance(16 * 60_000);
    const browser = newBrowser();
    await browser.refresh();
    const response = await browser.post('/api/auth/enroll/options', { token });
    expect(response.json()).toMatchObject({ error: 'link_invalid' });
  });

  it('stores only the hash of the session token', async () => {
    const { browser } = await enrolledUser();
    const token = browser.cookies['__Host-j4m_session']!;
    const rows = await ctx.deps.db.select().from(schema.sessions);
    for (const row of rows) {
      expect(row.tokenHash.toString('base64url')).not.toBe(token);
      expect(row.tokenHash.toString('utf8')).not.toContain(token);
    }
  });
});

describe('passkey sign-in (threat model rows 1 to 4)', () => {
  it('signs in with a passkey and gives a new session token', async () => {
    const { browser, authenticator, user } = await enrolledUser();
    const before = browser.cookies['__Host-j4m_session'];
    await browser.post('/api/auth/logout');
    const response = await passkeySignIn(browser, authenticator);
    expect(response.statusCode).toBe(200);
    expect(browser.cookies['__Host-j4m_session']).not.toBe(before);
    expect(await auditActions(user.id)).toContain('auth.login.succeeded');
  });

  it('ends the session on logout', async () => {
    const { browser } = await enrolledUser();
    const stolen = { ...browser.cookies };
    await browser.post('/api/auth/logout');
    const replay = await ctx.app.inject({ url: '/api/auth/security', cookies: stolen });
    expect(replay.statusCode).toBe(401);
  });

  it('refuses an answer signed for another origin (phishing relay)', async () => {
    const { browser, authenticator } = await enrolledUser();
    await browser.post('/api/auth/logout');
    await browser.refresh();
    const { options } = (await browser.post('/api/auth/passkey/options')).json<Options>();
    const response = await browser.post('/api/auth/passkey/verify', {
      response: authenticator.authenticate(options, { origin: 'https://job4me-login.example' }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'passkey_failed' });
  });

  it('refuses a replayed answer', async () => {
    const { browser, authenticator } = await enrolledUser();
    await browser.post('/api/auth/logout');
    await browser.refresh();
    const { options } = (await browser.post('/api/auth/passkey/options')).json<Options>();
    const answer = authenticator.authenticate(options);
    expect((await browser.post('/api/auth/passkey/verify', { response: answer })).statusCode).toBe(
      200,
    );
    await browser.post('/api/auth/logout');
    await browser.refresh();
    const replay = await browser.post('/api/auth/passkey/verify', { response: answer });
    expect(replay.statusCode).toBe(400);
  });

  it('refuses a signature counter that goes backwards (cloned key)', async () => {
    const { browser, authenticator } = await enrolledUser();
    await browser.post('/api/auth/logout');
    expect((await passkeySignIn(browser, authenticator)).statusCode).toBe(200);
    await browser.post('/api/auth/logout');
    await browser.refresh();
    const { options } = (await browser.post('/api/auth/passkey/options')).json<Options>();
    const response = await browser.post('/api/auth/passkey/verify', {
      response: authenticator.authenticate(options, { counter: 1 }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('accepts synced passkeys, which always report a zero counter', async () => {
    const { browser, authenticator } = await enrolledUser({ synced: true });
    for (let i = 0; i < 2; i += 1) {
      await browser.post('/api/auth/logout');
      expect((await passkeySignIn(browser, authenticator)).statusCode).toBe(200);
    }
  });

  it('expires an idle session', async () => {
    const { browser } = await enrolledUser();
    advance((settings().auth.session.idleTimeoutMinutes + 1) * 60_000);
    expect((await browser.get('/api/auth/security')).statusCode).toBe(401);
  });
});

describe('password + second factor fallback', () => {
  async function passwordStep(browser: TestBrowser, email: string, password = PASSWORD) {
    await browser.refresh();
    return browser.post('/api/auth/password', { email, password });
  }

  it('never signs in with the password alone', async () => {
    const { email, browser } = await enrolledUser();
    await enableTotp(browser);
    await browser.post('/api/auth/logout');
    const step = await passwordStep(browser, email);
    expect(step.json()).toEqual({ next: 'second_factor' });
    expect((await browser.get('/api/auth/security')).statusCode).toBe(401);
  });

  it('signs in with password and TOTP, and refuses the same code twice', async () => {
    const { email, browser } = await enrolledUser();
    const secret = await enableTotp(browser);
    await browser.post('/api/auth/logout');
    advance(60_000);
    const code = generateTotpCode(secret, current.getTime());
    await passwordStep(browser, email);
    const signedIn = await browser.post('/api/auth/second-factor', { code });
    expect(signedIn.statusCode).toBe(200);
    await browser.post('/api/auth/logout');
    await passwordStep(browser, email);
    const replay = await browser.post('/api/auth/second-factor', { code });
    expect(replay.json()).toMatchObject({ error: 'invalid_code' });
  });

  it('accepts a recovery code once', async () => {
    const { email, browser } = await enrolledUser();
    await enableTotp(browser);
    const { codes } = (await browser.post('/api/auth/recovery-codes')).json<{ codes: string[] }>();
    expect(codes).toHaveLength(settings().auth.recoveryCodes.count);
    await browser.post('/api/auth/logout');
    await passwordStep(browser, email);
    expect((await browser.post('/api/auth/second-factor', { code: codes[0] })).statusCode).toBe(
      200,
    );
    await browser.post('/api/auth/logout');
    await passwordStep(browser, email);
    const again = await browser.post('/api/auth/second-factor', { code: codes[0] });
    expect(again.statusCode).toBe(401);
  });

  it('answers the same way for an unknown e-mail and a wrong password', async () => {
    const { email } = await enrolledUser();
    const browser = newBrowser();
    const unknown = await passwordStep(browser, 'nobody@example.org');
    const wrong = await passwordStep(browser, email, 'not the right password');
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json<{ error: string }>().error).toBe(wrong.json<{ error: string }>().error);
  });

  it('locks the password after repeated failures, but never the passkey', async () => {
    const { email, browser, authenticator, user } = await enrolledUser();
    await browser.post('/api/auth/logout');
    const attacker = newBrowser();
    for (let i = 0; i < settings().auth.lockout.threshold; i += 1) {
      await passwordStep(attacker, email, `wrong password ${i}`);
    }
    const locked = await passwordStep(attacker, email);
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: 'locked' });
    expect(locked.headers['retry-after']).toBeDefined();
    expect((await passkeySignIn(browser, authenticator)).statusCode).toBe(200);
    expect(await auditActions(user.id)).toContain('auth.locked');
    advance(settings().auth.lockout.baseDelaySeconds * 1000 + 1000);
    expect((await passwordStep(attacker, email)).statusCode).toBe(200);
  });
});

describe('re-authentication for sensitive actions', () => {
  it('requires a recent sign-in, then accepts a passkey check', async () => {
    const { browser, authenticator } = await enrolledUser();
    advance((settings().auth.session.reauthWindowMinutes + 1) * 60_000);
    const denied = await browser.post('/api/auth/recovery-codes');
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'reauth_required' });
    const before = browser.cookies['__Host-j4m_session'];
    const { options } = (await browser.post('/api/auth/reauth/passkey/options')).json<Options>();
    const reauth = await browser.post('/api/auth/reauth/passkey/verify', {
      response: authenticator.authenticate(options),
    });
    expect(reauth.statusCode).toBe(200);
    expect(browser.cookies['__Host-j4m_session']).not.toBe(before);
    expect((await browser.post('/api/auth/recovery-codes')).statusCode).toBe(200);
  });

  it('accepts password + TOTP as a re-authentication', async () => {
    const { browser } = await enrolledUser();
    const secret = await enableTotp(browser);
    advance((settings().auth.session.reauthWindowMinutes + 1) * 60_000);
    const reauth = await browser.post('/api/auth/reauth/password', {
      password: PASSWORD,
      code: generateTotpCode(secret, current.getTime()),
    });
    expect(reauth.statusCode).toBe(200);
  });
});

describe('account management', () => {
  it('adds, renames and removes passkeys, but keeps at least one way in', async () => {
    const { browser, user } = await enrolledUser();
    const second = newAuthenticator();
    const { options } = (await browser.post('/api/auth/passkeys/options')).json<Options>();
    const added = await browser.post('/api/auth/passkeys/verify', {
      response: second.register(options),
      name: 'Téléphone',
    });
    expect(added.statusCode).toBe(200);
    const { id } = added.json<{ id: string }>();
    const renamed = await browser.send('PATCH', `/api/auth/passkeys/${id}`, { name: 'iPhone' });
    expect(renamed.json()).toMatchObject({ name: 'iPhone' });
    expect((await browser.send('DELETE', `/api/auth/passkeys/${id}`)).statusCode).toBe(200);
    const overview = (await browser.get('/api/auth/security')).json<{
      passkeys: Array<{ id: string }>;
    }>();
    expect(overview.passkeys).toHaveLength(1);
    const last = await browser.send('DELETE', `/api/auth/passkeys/${overview.passkeys[0]!.id}`);
    expect(last.statusCode).toBe(409);
    expect(last.json()).toMatchObject({ error: 'last_sign_in_method' });
    expect(await auditActions(user.id)).toEqual(
      expect.arrayContaining(['passkey.registered', 'passkey.renamed', 'passkey.removed']),
    );
  });

  it('rejects a weak new password', async () => {
    const { browser } = await enrolledUser();
    const weakPassword = 'azerty123456'; // gitleaks:allow (test value)
    const weak = await browser.post('/api/auth/password/change', { newPassword: weakPassword });
    expect(weak.json()).toMatchObject({ error: 'password_too_weak' });
    const strong = await browser.post('/api/auth/password/change', {
      newPassword: 'une autre phrase de passe assez longue', // gitleaks:allow (test value)
    });
    expect(strong.statusCode).toBe(200);
  });

  it('lists live sessions and revokes the others', async () => {
    const { browser, authenticator } = await enrolledUser();
    const other = newBrowser();
    expect((await passkeySignIn(other, authenticator)).statusCode).toBe(200);
    const list = (await browser.get('/api/auth/sessions')).json<{
      sessions: Array<{ current: boolean }>;
    }>();
    expect(list.sessions).toHaveLength(2);
    expect(list.sessions.filter((session) => session.current)).toHaveLength(1);
    const revoked = await browser.post('/api/auth/sessions/revoke-others');
    expect(revoked.json()).toEqual({ revoked: 1 });
    expect((await other.get('/api/auth/security')).statusCode).toBe(401);
  });

  it('shows the signed-in user only their own audit events', async () => {
    const { browser, user } = await enrolledUser();
    const { user: otherUser } = await enrolledUser();
    const { entries } = (await browser.get('/api/audit?limit=100')).json<{
      entries: Array<{ action: string }>;
    }>();
    expect(entries.length).toBeGreaterThan(0);
    const rows = await ctx.deps.db.select().from(schema.auditLog);
    const otherCount = rows.filter((row) => row.actorUserId === otherUser.id).length;
    const ownCount = rows.filter((row) => row.actorUserId === user.id).length;
    expect(otherCount).toBeGreaterThan(0);
    expect(entries).toHaveLength(ownCount);
  });
});

describe('isolation between accounts (threat model row 7)', () => {
  it('never lets one account act on the passkeys or sessions of another', async () => {
    const a = await enrolledUser();
    const b = await enrolledUser();
    const passkeyOfB = (await b.browser.get('/api/auth/security')).json<{
      passkeys: Array<{ id: string }>;
    }>().passkeys[0]!.id;
    const sessionOfB = (await b.browser.get('/api/auth/sessions')).json<{
      sessions: Array<{ id: string }>;
    }>().sessions[0]!.id;
    expect((await a.browser.send('DELETE', `/api/auth/passkeys/${passkeyOfB}`)).statusCode).toBe(
      404,
    );
    expect(
      (await a.browser.send('PATCH', `/api/auth/passkeys/${passkeyOfB}`, { name: 'x' })).statusCode,
    ).toBe(404);
    expect((await a.browser.send('DELETE', `/api/auth/sessions/${sessionOfB}`)).statusCode).toBe(
      404,
    );
    expect((await b.browser.get('/api/auth/security')).statusCode).toBe(200);
  });
});

describe('secrets at rest (threat model row 9)', () => {
  it('keeps the TOTP secret encrypted and recovery codes hashed', async () => {
    const { browser, user } = await enrolledUser();
    const secret = await enableTotp(browser);
    const { codes } = (await browser.post('/api/auth/recovery-codes')).json<{ codes: string[] }>();
    const totpRows = await ctx.deps.db.select().from(schema.totpSecrets);
    const totp = totpRows.find((row) => row.userId === user.id)!;
    expect(totp.secretCiphertext!.toString('utf8')).not.toContain(secret);
    const recoveryRows = await ctx.deps.db.select().from(schema.recoveryCodes);
    const stored = recoveryRows
      .filter((row) => row.userId === user.id)
      .map((row) => row.codeHmac.toString('utf8'))
      .join('');
    for (const code of codes) expect(stored).not.toContain(code.replaceAll('-', ''));
  });
});
