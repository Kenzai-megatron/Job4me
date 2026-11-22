import type { FastifyRequest } from 'fastify';
import type { AppDeps } from '../../context';
import { HttpError } from '../../errors';
import type { SessionContext } from '../../request-context';
import { authDurations, clock } from './clock';

export function requireSession(request: FastifyRequest): SessionContext {
  if (!request.session) throw new HttpError(401, 'unauthenticated');
  return request.session;
}

/** Sensitive actions need a sign-in or re-authentication younger than the configured window. */
export function requireRecentAuth(request: FastifyRequest, deps: AppDeps): SessionContext {
  const session = requireSession(request);
  const age = clock(deps)().getTime() - session.reauthenticatedAt.getTime();
  if (age > authDurations(deps.config.settings).reauthMs) {
    throw new HttpError(403, 'reauth_required');
  }
  return session;
}

export function reauthUntil(session: SessionContext, deps: AppDeps): string {
  const until = session.reauthenticatedAt.getTime() + authDurations(deps.config.settings).reauthMs;
  return new Date(until).toISOString();
}
