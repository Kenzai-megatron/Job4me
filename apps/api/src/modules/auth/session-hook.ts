import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../context';
import { isTokenShaped, SESSION_COOKIE } from '../../cookies';
import { authDurations, clock } from './clock';
import { findLiveSession, touchSession } from './sessions';

/** Attaches the signed-in session to API requests that carry a valid session cookie. */
export function registerSessionHook(app: FastifyInstance, deps: AppDeps): void {
  const durations = authDurations(deps.config.settings);
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const token = request.cookies[SESSION_COOKIE];
    if (!isTokenShaped(token)) return;
    const now = clock(deps)();
    const session = await findLiveSession(deps.db, token, now);
    if (!session) return;
    request.session = {
      id: session.id,
      userId: session.userId,
      authMethod: session.authMethod as 'passkey' | 'password_totp' | 'password_recovery',
      reauthenticatedAt: session.reauthenticatedAt,
      createdAt: session.createdAt,
    };
    if (now.getTime() - session.lastSeenAt.getTime() > durations.touchMs) {
      await touchSession(deps.db, session.id, now, durations.idleMs);
    }
  });
}
