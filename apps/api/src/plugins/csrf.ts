import { verifyCsrfToken } from '@job4me/security';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from '../errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** What a CSRF token is bound to: the session if signed in, else the pre-login cookie. */
export function csrfBinding(request: FastifyRequest): string | null {
  if (request.session) return `session:${request.session.id}`;
  if (request.preSessionId) return `pre:${request.preSessionId}`;
  return null;
}

/**
 * Three layers (SPEC section 11): SameSite=Strict cookies, an Origin check and a token
 * sent in the x-csrf-token header on every state-changing request.
 */
export function registerCsrf(
  app: FastifyInstance,
  options: { allowedOrigins: string[]; csrfKey: Buffer },
): void {
  const allowed = new Set(options.allowedOrigins);
  app.addHook('preValidation', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !allowed.has(origin)) {
      throw new HttpError(403, 'csrf_failed');
    }
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite !== undefined && fetchSite !== 'same-origin') {
      throw new HttpError(403, 'csrf_failed');
    }
    const token = request.headers['x-csrf-token'];
    const binding = csrfBinding(request);
    if (
      typeof token !== 'string' ||
      binding === null ||
      !verifyCsrfToken(options.csrfKey, binding, token)
    ) {
      throw new HttpError(403, 'csrf_failed');
    }
  });
}
