import { sessionStateSchema } from '@job4me/contracts';
import { csrfToken } from '@job4me/security';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../context';
import { csrfBinding } from '../plugins/csrf';
import { ensurePreSession } from '../plugins/pre-session';

export function sessionRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  return async (app) => {
    // Called by the interface on load: session state plus the CSRF token for later requests.
    app.get(
      '/api/auth/session',
      { schema: { response: { 200: sessionStateSchema } } },
      (request, reply) => {
        if (!request.session) ensurePreSession(request, reply);
        const binding = csrfBinding(request);
        return {
          authenticated: request.session !== null,
          csrfToken: binding ? csrfToken(deps.keys.csrf, binding) : '',
        };
      },
    );
  };
}
