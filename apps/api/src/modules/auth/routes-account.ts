import {
  addPasskeyVerifyRequestSchema,
  auditQuerySchema,
  auditResponseSchema,
  changePasswordRequestSchema,
  idParamsSchema,
  okResponseSchema,
  optionsResponseSchema,
  passkeySummarySchema,
  passkeyVerifyRequestSchema,
  passwordFallbackRequestSchema,
  reauthPasswordRequestSchema,
  reauthResponseSchema,
  recoveryCodesResponseSchema,
  renamePasskeyRequestSchema,
  revokedResponseSchema,
  securityOverviewSchema,
  sessionsResponseSchema,
  totpConfirmRequestSchema,
  totpSetupResponseSchema,
} from '@job4me/contracts';
import { eq, schema } from '@job4me/db';
import { csrfToken, verifyPassword } from '@job4me/security';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import QRCode from 'qrcode';
import type { AppDeps } from '../../context';
import { HttpError } from '../../errors';
import type { SessionContext } from '../../request-context';
import { listAuditForUser } from '@job4me/db';
import { consumeChallenge, storeChallenge } from './challenges';
import { addMs, authDurations, clock } from './clock';
import { reauthUntil, requireRecentAuth, requireSession } from './guards';
import {
  authenticationOptions,
  deletePasskey,
  listPasskeys,
  markPasskeyUsed,
  registrationOptions,
  renamePasskey,
  storePasskey,
  summarizePasskey,
  verifyAssertion,
  verifyRegistration,
} from './passkeys';
import { countUnusedRecoveryCodes, regenerateRecoveryCodes, useRecoveryCode } from './recovery';
import {
  clearSessionCookie,
  listLiveSessions,
  revokeOtherSessions,
  revokeSession,
  rotateSession,
  setSessionCookie,
} from './sessions';
import { audit } from './sign-in';
import { type Factor, lockedForSeconds, registerFailure, resetFailures } from './throttle';
import { confirmTotpSetup, isTotpEnabled, startTotpSetup, useTotpCode } from './totp';
import { findUserById, PasswordTooWeakError, preparePassword } from './users';
import { userAgentLabel } from './user-agent';

export function accountRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  const { settings } = deps.config;
  const now = clock(deps);
  const durations = authDurations(settings);
  // Routes that check a secret or hash a password (Argon2id is costly): same budget as sign-in.
  const rateLimit = {
    rateLimit: { max: settings.auth.rateLimit.authRequestsPerMinute, timeWindow: '1 minute' },
  };

  async function currentUser(session: SessionContext) {
    const user = await findUserById(deps.db, session.userId);
    if (!user || user.status !== 'active') throw new HttpError(401, 'unauthenticated');
    return user;
  }

  /** New token and a fresh re-authentication time; the CSRF token stays bound to the session. */
  async function completeReauth(
    request: FastifyRequest,
    reply: Parameters<typeof setSessionCookie>[0],
    session: SessionContext,
    method: string,
  ) {
    const at = now();
    const token = await rotateSession(deps.db, session.id, at);
    setSessionCookie(reply, token, addMs(session.createdAt, durations.absoluteMs));
    session.reauthenticatedAt = at;
    await audit(deps, request, {
      actorUserId: session.userId,
      action: 'auth.reauth',
      outcome: 'success',
      metadata: { method },
    });
    return {
      reauthUntil: reauthUntil(session, deps),
      csrfToken: csrfToken(deps.keys.csrf, `session:${session.id}`),
    };
  }

  async function reauthFailure(request: FastifyRequest, userId: string, factor: Factor | null) {
    if (factor) {
      const result = await registerFailure(deps.db, userId, factor, now(), settings.auth.lockout);
      if (result.lockedSeconds !== null) {
        await audit(deps, request, {
          actorUserId: userId,
          action: 'auth.locked',
          outcome: 'denied',
          metadata: { factor, seconds: result.lockedSeconds },
        });
      }
    }
    await audit(deps, request, {
      actorUserId: userId,
      action: 'auth.reauth',
      outcome: 'failure',
      metadata: { factor },
    });
  }

  async function ensureNotLocked(userId: string, factor: Factor) {
    const seconds = await lockedForSeconds(deps.db, userId, factor, now());
    if (seconds !== null) throw new HttpError(429, 'locked', { retryAfterSeconds: seconds });
  }

  return async (app) => {
    app.get(
      '/api/auth/security',
      { schema: { response: { 200: securityOverviewSchema } } },
      async (request) => {
        const session = requireSession(request);
        const user = await currentUser(session);
        return {
          passkeys: (await listPasskeys(deps.db, user.id)).map(summarizePasskey),
          totpEnabled: await isTotpEnabled(deps.db, user.id),
          recoveryCodesRemaining: await countUnusedRecoveryCodes(deps.db, user.id),
          password: {
            isSet: user.passwordHash !== null,
            fallbackEnabled: user.passwordFallbackEnabled,
          },
          reauthUntil: reauthUntil(session, deps),
        };
      },
    );

    // Re-authentication, required by sensitive actions (ADR 0003).
    app.post(
      '/api/auth/reauth/passkey/options',
      { schema: { response: { 200: optionsResponseSchema } } },
      async (request) => {
        const session = requireSession(request);
        const options = await authenticationOptions(
          settings,
          await listPasskeys(deps.db, session.userId),
        );
        await storeChallenge(deps.db, {
          purpose: 'reauth',
          challenge: options.challenge,
          binding: `session:${session.id}`,
          userId: session.userId,
          expiresAt: addMs(now(), durations.challengeMs),
        });
        return { options: { ...options } };
      },
    );

    app.post(
      '/api/auth/reauth/passkey/verify',
      {
        config: rateLimit,
        schema: { body: passkeyVerifyRequestSchema, response: { 200: reauthResponseSchema } },
      },
      async (request, reply) => {
        const session = requireSession(request);
        const response = request.body.response as unknown as AuthenticationResponseJSON;
        const challenge = await consumeChallenge(deps.db, {
          purpose: 'reauth',
          binding: `session:${session.id}`,
          now: now(),
          userId: session.userId,
        });
        const passkey = (await listPasskeys(deps.db, session.userId)).find(
          (candidate) => candidate.credentialId === response.id,
        );
        if (!challenge?.challenge || !passkey) {
          await reauthFailure(request, session.userId, null);
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
          await reauthFailure(request, session.userId, null);
          throw new HttpError(400, 'passkey_failed');
        }
        return completeReauth(request, reply, session, 'passkey');
      },
    );

    app.post(
      '/api/auth/reauth/password',
      {
        config: rateLimit,
        schema: { body: reauthPasswordRequestSchema, response: { 200: reauthResponseSchema } },
      },
      async (request, reply) => {
        const session = requireSession(request);
        const user = await currentUser(session);
        const code = request.body.code.trim();
        const factor: Factor = /^\d{6}$/.test(code) ? 'totp' : 'recovery';
        await ensureNotLocked(user.id, 'password');
        await ensureNotLocked(user.id, factor);
        const passwordValid =
          user.passwordHash !== null &&
          user.passwordFallbackEnabled &&
          (await verifyPassword(user.passwordHash, request.body.password));
        if (!passwordValid) {
          await reauthFailure(request, user.id, 'password');
          throw new HttpError(401, 'invalid_credentials');
        }
        const codeValid =
          factor === 'totp'
            ? await useTotpCode(deps.db, {
                userId: user.id,
                totpKey: deps.keys.totp,
                code,
                window: settings.auth.totp.window,
                now: now(),
              })
            : await useRecoveryCode(deps.db, {
                userId: user.id,
                recoveryKey: deps.keys.recovery,
                code,
                now: now(),
              });
        if (!codeValid) {
          await reauthFailure(request, user.id, factor);
          throw new HttpError(401, 'invalid_code');
        }
        await resetFailures(deps.db, user.id, 'password');
        await resetFailures(deps.db, user.id, factor);
        return completeReauth(request, reply, session, `password_${factor}`);
      },
    );

    // TOTP: a new secret, then a confirmation code.
    app.post(
      '/api/auth/totp/setup',
      { schema: { response: { 200: totpSetupResponseSchema } } },
      async (request) => {
        const session = requireRecentAuth(request, deps);
        const user = await currentUser(session);
        const { secret, uri } = await startTotpSetup(deps.db, {
          userId: user.id,
          totpKey: deps.keys.totp,
          issuer: settings.auth.totp.issuer,
          label: user.email,
          now: now(),
        });
        await audit(deps, request, {
          actorUserId: user.id,
          action: 'totp.setup_started',
          outcome: 'success',
        });
        const qrCode = await QRCode.toDataURL(uri, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 240,
        });
        return { secret, uri, qrCode };
      },
    );

    app.post(
      '/api/auth/totp/confirm',
      {
        config: rateLimit,
        schema: { body: totpConfirmRequestSchema, response: { 200: okResponseSchema } },
      },
      async (request) => {
        const session = requireSession(request);
        const confirmed = await confirmTotpSetup(deps.db, {
          userId: session.userId,
          totpKey: deps.keys.totp,
          code: request.body.code,
          window: settings.auth.totp.window,
          now: now(),
        });
        await audit(deps, request, {
          actorUserId: session.userId,
          action: 'totp.enabled',
          outcome: confirmed ? 'success' : 'failure',
        });
        if (!confirmed) throw new HttpError(400, 'invalid_code');
        return { ok: true as const };
      },
    );

    app.post(
      '/api/auth/recovery-codes',
      { schema: { response: { 200: recoveryCodesResponseSchema } } },
      async (request) => {
        const session = requireRecentAuth(request, deps);
        const codes = await regenerateRecoveryCodes(deps.db, {
          userId: session.userId,
          recoveryKey: deps.keys.recovery,
          count: settings.auth.recoveryCodes.count,
        });
        await audit(deps, request, {
          actorUserId: session.userId,
          action: 'recovery_codes.generated',
          outcome: 'success',
          metadata: { count: codes.length },
        });
        return { codes };
      },
    );

    // Passkeys of the signed-in user.
    app.post(
      '/api/auth/passkeys/options',
      { schema: { response: { 200: optionsResponseSchema } } },
      async (request) => {
        const session = requireRecentAuth(request, deps);
        const user = await currentUser(session);
        const options = await registrationOptions(
          settings,
          user,
          await listPasskeys(deps.db, user.id),
        );
        await storeChallenge(deps.db, {
          purpose: 'registration',
          challenge: options.challenge,
          binding: `session:${session.id}`,
          userId: user.id,
          expiresAt: addMs(now(), durations.challengeMs),
        });
        return { options: { ...options } };
      },
    );

    app.post(
      '/api/auth/passkeys/verify',
      {
        schema: { body: addPasskeyVerifyRequestSchema, response: { 200: passkeySummarySchema } },
      },
      async (request) => {
        const session = requireRecentAuth(request, deps);
        const challenge = await consumeChallenge(deps.db, {
          purpose: 'registration',
          binding: `session:${session.id}`,
          now: now(),
          userId: session.userId,
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
            actorUserId: session.userId,
            action: 'passkey.registered',
            outcome: 'failure',
          });
          throw new HttpError(400, 'passkey_failed');
        }
        const passkey = await storePasskey(deps.db, {
          userId: session.userId,
          name: request.body.name ?? userAgentLabel(request.headers['user-agent']) ?? 'Passkey',
          info,
        });
        await audit(deps, request, {
          actorUserId: session.userId,
          action: 'passkey.registered',
          outcome: 'success',
          targetType: 'passkey',
          targetId: passkey.id,
          metadata: { synced: passkey.backedUp },
        });
        return summarizePasskey(passkey);
      },
    );

    app.patch(
      '/api/auth/passkeys/:id',
      {
        schema: {
          params: idParamsSchema,
          body: renamePasskeyRequestSchema,
          response: { 200: passkeySummarySchema },
        },
      },
      async (request) => {
        const session = requireSession(request);
        const passkey = await renamePasskey(
          deps.db,
          session.userId,
          request.params.id,
          request.body.name,
        );
        if (!passkey) throw new HttpError(404, 'not_found');
        await audit(deps, request, {
          actorUserId: session.userId,
          action: 'passkey.renamed',
          outcome: 'success',
          targetType: 'passkey',
          targetId: passkey.id,
        });
        return summarizePasskey(passkey);
      },
    );

    app.delete(
      '/api/auth/passkeys/:id',
      { schema: { params: idParamsSchema, response: { 200: okResponseSchema } } },
      async (request) => {
        const session = requireRecentAuth(request, deps);
        const user = await currentUser(session);
        const passkeys = await listPasskeys(deps.db, user.id);
        if (!passkeys.some((passkey) => passkey.id === request.params.id)) {
          throw new HttpError(404, 'not_found');
        }
        const fallbackUsable =
          user.passwordHash !== null &&
          user.passwordFallbackEnabled &&
          (await isTotpEnabled(deps.db, user.id));
        if (passkeys.length === 1 && !fallbackUsable) {
          throw new HttpError(409, 'last_sign_in_method');
        }
        await deletePasskey(deps.db, user.id, request.params.id);
        await audit(deps, request, {
          actorUserId: user.id,
          action: 'passkey.removed',
          outcome: 'success',
          targetType: 'passkey',
          targetId: request.params.id,
        });
        return { ok: true as const };
      },
    );

    // Password fallback.
    app.post(
      '/api/auth/password/change',
      {
        config: rateLimit,
        schema: { body: changePasswordRequestSchema, response: { 200: okResponseSchema } },
      },
      async (request) => {
        const session = requireRecentAuth(request, deps);
        let passwordHash: string;
        try {
          passwordHash = await preparePassword(request.body.newPassword, settings);
        } catch (error) {
          if (error instanceof PasswordTooWeakError) {
            throw new HttpError(400, 'password_too_weak');
          }
          throw error;
        }
        await deps.db
          .update(schema.users)
          .set({ passwordHash, updatedAt: now() })
          .where(eq(schema.users.id, session.userId));
        await audit(deps, request, {
          actorUserId: session.userId,
          action: 'password.changed',
          outcome: 'success',
        });
        return { ok: true as const };
      },
    );

    app.post(
      '/api/auth/password-fallback',
      { schema: { body: passwordFallbackRequestSchema, response: { 200: okResponseSchema } } },
      async (request) => {
        const session = requireRecentAuth(request, deps);
        if (!request.body.enabled) {
          const passkeys = await listPasskeys(deps.db, session.userId);
          if (passkeys.length < 2) throw new HttpError(409, 'last_sign_in_method');
        }
        await deps.db
          .update(schema.users)
          .set({ passwordFallbackEnabled: request.body.enabled, updatedAt: now() })
          .where(eq(schema.users.id, session.userId));
        await audit(deps, request, {
          actorUserId: session.userId,
          action: request.body.enabled ? 'password_fallback.enabled' : 'password_fallback.disabled',
          outcome: 'success',
        });
        return { ok: true as const };
      },
    );

    // Sessions.
    app.get(
      '/api/auth/sessions',
      { schema: { response: { 200: sessionsResponseSchema } } },
      async (request) => {
        const session = requireSession(request);
        const rows = await listLiveSessions(deps.db, session.userId, now());
        return {
          sessions: rows.map((row) => ({
            id: row.id,
            authMethod: row.authMethod as 'passkey' | 'password_totp' | 'password_recovery',
            userAgentLabel: row.userAgentLabel,
            createdAt: row.createdAt.toISOString(),
            lastSeenAt: row.lastSeenAt.toISOString(),
            current: row.id === session.id,
          })),
        };
      },
    );

    app.delete(
      '/api/auth/sessions/:id',
      { schema: { params: idParamsSchema, response: { 200: okResponseSchema } } },
      async (request, reply) => {
        const session = requireSession(request);
        const revoked = await revokeSession(deps.db, session.userId, request.params.id, now());
        if (!revoked) throw new HttpError(404, 'not_found');
        if (request.params.id === session.id) clearSessionCookie(reply);
        await audit(deps, request, {
          actorUserId: session.userId,
          action: 'session.revoked',
          outcome: 'success',
          targetType: 'session',
          targetId: request.params.id,
        });
        return { ok: true as const };
      },
    );

    app.post(
      '/api/auth/sessions/revoke-others',
      { schema: { response: { 200: revokedResponseSchema } } },
      async (request) => {
        const session = requireRecentAuth(request, deps);
        const revoked = await revokeOtherSessions(deps.db, session.userId, session.id, now());
        await audit(deps, request, {
          actorUserId: session.userId,
          action: 'sessions.revoked_others',
          outcome: 'success',
          metadata: { count: revoked },
        });
        return { revoked };
      },
    );

    // Audit log of the signed-in user (Settings > Security).
    app.get(
      '/api/audit',
      { schema: { querystring: auditQuerySchema, response: { 200: auditResponseSchema } } },
      async (request) => {
        const session = requireSession(request);
        const rows = await listAuditForUser(deps.db, session.userId, {
          limit: request.query.limit,
          ...(request.query.before ? { beforeId: request.query.before } : {}),
        });
        return {
          entries: rows.map((row) => ({
            id: row.id,
            occurredAt: row.occurredAt.toISOString(),
            action: row.action,
            outcome: row.outcome as 'success' | 'failure' | 'denied',
            metadata: row.metadata as Record<string, string | number | boolean | null>,
          })),
        };
      },
    );
  };
}
