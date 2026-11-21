import { randomToken } from '@job4me/security';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { baseCookieOptions, isTokenShaped, PRE_SESSION_COOKIE } from '../cookies';

const PRE_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Reads the pre-login cookie on every request. */
export function registerPreSession(app: FastifyInstance): void {
  app.decorateRequest('preSessionId', null);
  app.decorateRequest('session', null);
  app.addHook('onRequest', async (request) => {
    const value = request.cookies[PRE_SESSION_COOKIE];
    request.preSessionId = isTokenShaped(value) ? value : null;
  });
}

/** Issues the pre-login cookie when the browser has none yet. */
export function ensurePreSession(request: FastifyRequest, reply: FastifyReply): string {
  if (request.preSessionId) return request.preSessionId;
  const value = randomToken();
  reply.setCookie(PRE_SESSION_COOKIE, value, {
    ...baseCookieOptions,
    maxAge: PRE_SESSION_MAX_AGE_SECONDS,
  });
  request.preSessionId = value;
  return value;
}
