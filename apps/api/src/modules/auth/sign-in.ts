import { csrfToken } from '@job4me/security';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../context';
import { csrfBinding } from '../../plugins/csrf';
import { type AuditEvent, recordAudit } from '../audit/audit';
import { authDurations, clock } from './clock';
import { type AuthMethod, createSession, setSessionCookie } from './sessions';
import { userAgentLabel } from './user-agent';

/** Records an audit event for the current request. */
export function audit(
  deps: AppDeps,
  request: FastifyRequest,
  event: Omit<AuditEvent, 'requestId' | 'actorType'> & { actorType?: AuditEvent['actorType'] },
) {
  return recordAudit(deps.db, {
    actorType: 'user',
    requestId: request.id,
    ...event,
  });
}

/** Opens a fresh session (never reuses one: no session fixation) and returns the new CSRF token. */
export async function signIn(
  deps: AppDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  input: { userId: string; authMethod: AuthMethod },
) {
  const now = clock(deps)();
  const durations = authDurations(deps.config.settings);
  const session = await createSession(deps.db, {
    userId: input.userId,
    authMethod: input.authMethod,
    userAgentLabel: userAgentLabel(request.headers['user-agent']),
    now,
    times: durations,
  });
  setSessionCookie(reply, session.token, session.absoluteExpiresAt);
  request.session = {
    id: session.id,
    userId: input.userId,
    authMethod: input.authMethod,
    reauthenticatedAt: now,
    createdAt: now,
  };
  await audit(deps, request, {
    actorUserId: input.userId,
    action: 'auth.login.succeeded',
    outcome: 'success',
    targetType: 'session',
    targetId: session.id,
    metadata: { method: input.authMethod },
  });
  return { ok: true as const, csrfToken: csrfToken(deps.keys.csrf, csrfBinding(request)!) };
}
