import {
  enrollOptionsRequestSchema,
  enrollVerifyRequestSchema,
  okResponseSchema,
  optionsResponseSchema,
  passkeyVerifyRequestSchema,
  passwordLoginRequestSchema,
  passwordStepResponseSchema,
  secondFactorRequestSchema,
  sessionStateSchema,
  signedInResponseSchema,
} from '@job4me/contracts';
import { schema } from '@job4me/db';
import { csrfToken, hashPassword, needsRehash, verifyPassword } from '@job4me/security';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { eq } from '@job4me/db';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../context';
import { HttpError } from '../../errors';
import { csrfBinding } from '../../plugins/csrf';
import { ensurePreSession } from '../../plugins/pre-session';
import {
  consumeChallenge,
  consumeChallengeById,
  peekChallenge,
  storeChallenge,
} from './challenges';
import { addMs, authDurations, clock } from './clock';
import {
  authenticationOptions,
  findPasskeyByCredentialId,
  listPasskeys,
  markPasskeyUsed,
  registrationOptions,
  storePasskey,
  verifyAssertion,
  verifyRegistration,
} from './passkeys';
import { useRecoveryCode, countUnusedRecoveryCodes } from './recovery';
import { clearSessionCookie, revokeSession } from './sessions';
import { audit, signIn } from './sign-in';
import { type Factor, lockedForSeconds, registerFailure, resetFailures } from './throttle';
import { useTotpCode } from './totp';
import { userAgentLabel } from './user-agent';
import {
  consumeEnrollmentToken,
  findEnrollmentToken,
  findUserByEmail,
  findUserById,
} from './users';

function bindingOf(request: FastifyRequest): string {
  const binding = csrfBinding(request);
  // The CSRF check already guarantees a binding on every state-changing request.
  if (!binding) throw new HttpError(403, 'csrf_failed');
  return binding;
}

export function signInRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  const { settings } = deps.config;
  const now = clock(deps);
  const durations = authDurations(settings);
  const rateLimit = {
    rateLimit: { max: settings.auth.rateLimit.authRequestsPerMinute, timeWindow: '1 minute' },
  };

  // A password hash computed once, so unknown e-mails take as long as wrong passwords.
  let dummyHash: Promise<string> | undefined;
  const timingDecoy = (password: string) => {
    dummyHash ??= hashPassword('job4me-timing-decoy-password', settings.auth.password.argon2);
    return dummyHash.then((hash) => verifyPassword(hash, password));
  };

  async function failFactor(
    request: FastifyRequest,
    userId: string,
    factor: Factor,
    method: string,
  ): Promise<never> {
    const result = await registerFailure(deps.db, userId, factor, now(), settings.auth.lockout);
    await audit(deps, request, {
      actorUserId: userId,
      action: 'auth.login.failed',
      outcome: 'failure',
      metadata: { method, failures: result.failures },
    });
    if (result.lockedSeconds !== null) {
      await audit(deps, request, {
        actorUserId: userId,
        action: 'auth.locked',
        outcome: 'denied',
        metadata: { factor, seconds: result.lockedSeconds },
      });
    }
    throw new HttpError(401, factor === 'password' ? 'invalid_credentials' : 'invalid_code');
  }

  async function ensureNotLocked(userId: string, factor: Factor) {
    const seconds = await lockedForSeconds(deps.db, userId, factor, now());
    if (seconds !== null) throw new HttpError(429, 'locked', { retryAfterSeconds: seconds });
  }

  return async (app) => {
    app.get(
      '/api/auth/session',
      { schema: { response: { 200: sessionStateSchema } } },
      async (request, reply) => {
        if (!request.session) ensurePreSession(request, reply);
        const user = request.session ? await findUserById(deps.db, request.session.userId) : null;
        return {
          authenticated: request.session !== null,
          csrfToken: csrfToken(deps.keys.csrf, bindingOf(request)),
          ...(user
            ? {
                user: {
                  displayName: user.displayName,
                  locale: user.locale,
                  timeZone: user.timeZone,
                },
              }
            : {}),
        };
      },
    );

    // Enrollment: the one-time link from `pnpm job4me user:create` registers the first passkey.
    app.post(
      '/api/auth/enroll/options',
      {
        config: rateLimit,
        schema: { body: enrollOptionsRequestSchema, response: { 200: optionsResponseSchema } },
      },
      async (request) => {
        const token = await findEnrollmentToken(deps.db, request.body.token, now());
        if (!token) throw new HttpError(400, 'link_invalid');
        const user = (await findUserById(deps.db, token.userId))!;
        const options = await registrationOptions(
          settings,
          user,
          await listPasskeys(deps.db, user.id),
        );
        await storeChallenge(deps.db, {
          purpose: 'registration',
          challenge: options.challenge,
          binding: bindingOf(request),
          userId: user.id,
          expiresAt: addMs(now(), durations.challengeMs),
        });
        return { options: { ...options } };
      },
    );

    app.post(
      '/api/auth/enroll/verify',
      {
        config: rateLimit,
        schema: { body: enrollVerifyRequestSchema, response: { 200: signedInResponseSchema } },
      },
      async (request, reply) => {
        const token = await findEnrollmentToken(deps.db, request.body.token, now());
        if (!token) throw new HttpError(400, 'link_invalid');
        const challenge = await consumeChallenge(deps.db, {
          purpose: 'registration',
          binding: bindingOf(request),
          now: now(),
          userId: token.userId,
        });
        if (!challenge?.challenge) throw new HttpError(400, 'passkey_failed');
        let info: Awaited<ReturnType<typeof verifyRegistration>>;
        try {
          info = await verifyRegistration(
            settings,
            deps.config.allowedOrigins,
            request.body.response as unknown as RegistrationResponseJSON,
            challenge.challenge,
          );
        } catch {
          await audit(deps, request, {
            actorUserId: token.userId,
            action: 'passkey.registered',
            outcome: 'failure',
            metadata: { during: 'enrollment' },
          });
          throw new HttpError(400, 'passkey_failed');
        }
        const name =
          request.body.name ?? userAgentLabel(request.headers['user-agent']) ?? 'Passkey';
        const passkey = await deps.db.transaction(async (tx) => {
          if (!(await consumeEnrollmentToken(tx, token.id, now()))) return null;
          return storePasskey(tx, { userId: token.userId, name, info });
        });
        if (!passkey) throw new HttpError(400, 'link_invalid');
        await audit(deps, request, {
          actorUserId: token.userId,
          action: 'passkey.registered',
          outcome: 'success',
          targetType: 'passkey',
          targetId: passkey.id,
          metadata: { during: 'enrollment', synced: passkey.backedUp },
        });
        return signIn(deps, request, reply, { userId: token.userId, authMethod: 'passkey' });
      },
    );

    // Passkey sign-in: discoverable credentials, user verification required.
    app.post(
      '/api/auth/passkey/options',
      { config: rateLimit, schema: { response: { 200: optionsResponseSchema } } },
      async (request) => {
        const options = await authenticationOptions(settings);
        await storeChallenge(deps.db, {
          purpose: 'authentication',
          challenge: options.challenge,
          binding: bindingOf(request),
          userId: null,
          expiresAt: addMs(now(), durations.challengeMs),
        });
        return { options: { ...options } };
      },
    );

    app.post(
      '/api/auth/passkey/verify',
      {
        config: rateLimit,
        schema: { body: passkeyVerifyRequestSchema, response: { 200: signedInResponseSchema } },
      },
      async (request, reply) => {
        const response = request.body.response as unknown as AuthenticationResponseJSON;
        const challenge = await consumeChallenge(deps.db, {
          purpose: 'authentication',
          binding: bindingOf(request),
          now: now(),
        });
        const passkey = await findPasskeyByCredentialId(deps.db, response.id);
        const user = passkey ? await findUserById(deps.db, passkey.userId) : null;
        if (!challenge?.challenge || !passkey || !user || user.status !== 'active') {
          await audit(deps, request, {
            actorUserId: user?.id ?? null,
            action: 'auth.login.failed',
            outcome: 'failure',
            metadata: { method: 'passkey' },
          });
          throw new HttpError(400, 'passkey_failed');
        }
        try {
          const info = await verifyAssertion(
            settings,
            deps.config.allowedOrigins,
            response,
            challenge.challenge,
            passkey,
          );
          await markPasskeyUsed(deps.db, passkey.id, {
            counter: info.newCounter,
            backedUp: info.credentialBackedUp,
            now: now(),
          });
        } catch {
          await audit(deps, request, {
            actorUserId: user.id,
            action: 'auth.login.failed',
            outcome: 'failure',
            metadata: { method: 'passkey' },
          });
          throw new HttpError(400, 'passkey_failed');
        }
        return signIn(deps, request, reply, { userId: user.id, authMethod: 'passkey' });
      },
    );

    // Fallback, step 1: the password alone never opens a session.
    app.post(
      '/api/auth/password',
      {
        config: rateLimit,
        schema: {
          body: passwordLoginRequestSchema,
          response: { 200: passwordStepResponseSchema },
        },
      },
      async (request) => {
        const { email, password } = request.body;
        const user = await findUserByEmail(deps.db, email);
        if (!user) {
          await timingDecoy(password);
          throw new HttpError(401, 'invalid_credentials');
        }
        await ensureNotLocked(user.id, 'password');
        const usable = Boolean(
          user.passwordHash && user.passwordFallbackEnabled && user.status === 'active',
        );
        const valid = usable
          ? await verifyPassword(user.passwordHash!, password)
          : await timingDecoy(password).then(() => false);
        if (!valid) return failFactor(request, user.id, 'password', 'password');
        await resetFailures(deps.db, user.id, 'password');
        if (needsRehash(user.passwordHash!, settings.auth.password.argon2)) {
          await deps.db
            .update(schema.users)
            .set({ passwordHash: await hashPassword(password, settings.auth.password.argon2) })
            .where(eq(schema.users.id, user.id));
        }
        await storeChallenge(deps.db, {
          purpose: 'password_verified',
          challenge: null,
          binding: bindingOf(request),
          userId: user.id,
          expiresAt: addMs(now(), durations.passwordStepMs),
        });
        return { next: 'second_factor' as const };
      },
    );

    // Fallback, step 2: a TOTP code (6 digits) or a single-use recovery code.
    app.post(
      '/api/auth/second-factor',
      {
        config: rateLimit,
        schema: { body: secondFactorRequestSchema, response: { 200: signedInResponseSchema } },
      },
      async (request, reply) => {
        const pending = await peekChallenge(deps.db, {
          purpose: 'password_verified',
          binding: bindingOf(request),
          now: now(),
        });
        if (!pending?.userId) throw new HttpError(401, 'invalid_code');
        const userId = pending.userId;
        const code = request.body.code.trim();
        const isTotp = /^\d{6}$/.test(code);
        const factor: Factor = isTotp ? 'totp' : 'recovery';
        await ensureNotLocked(userId, factor);
        const valid = isTotp
          ? await useTotpCode(deps.db, {
              userId,
              totpKey: deps.keys.totp,
              code,
              window: settings.auth.totp.window,
              now: now(),
            })
          : await useRecoveryCode(deps.db, {
              userId,
              recoveryKey: deps.keys.recovery,
              code,
              now: now(),
            });
        if (!valid) {
          return failFactor(
            request,
            userId,
            factor,
            isTotp ? 'password_totp' : 'password_recovery',
          );
        }
        await resetFailures(deps.db, userId, factor);
        if (!(await consumeChallengeById(deps.db, pending.id, now()))) {
          throw new HttpError(401, 'invalid_code');
        }
        if (!isTotp) {
          await audit(deps, request, {
            actorUserId: userId,
            action: 'recovery_code.used',
            outcome: 'success',
            metadata: { remaining: await countUnusedRecoveryCodes(deps.db, userId) },
          });
        }
        return signIn(deps, request, reply, {
          userId,
          authMethod: isTotp ? 'password_totp' : 'password_recovery',
        });
      },
    );

    app.post(
      '/api/auth/logout',
      { schema: { response: { 200: okResponseSchema } } },
      async (request, reply) => {
        if (request.session) {
          await revokeSession(deps.db, request.session.userId, request.session.id, now());
          await audit(deps, request, {
            actorUserId: request.session.userId,
            action: 'auth.logout',
            outcome: 'success',
            targetType: 'session',
            targetId: request.session.id,
          });
        }
        clearSessionCookie(reply);
        return { ok: true as const };
      },
    );
  };
}
