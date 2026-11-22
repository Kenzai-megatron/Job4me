import {
  okResponseSchema,
  pushPublicKeyResponseSchema,
  pushStatusResponseSchema,
  pushSubscriptionSchema,
  pushUnsubscribeRequestSchema,
  QUEUES,
} from '@job4me/contracts';
import { and, count, eq, recordAudit, schema } from '@job4me/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../context';
import { HttpError } from '../../errors';
import { requireSession } from '../auth/guards';
import { userAgentLabel } from '../auth/user-agent';

/**
 * Push services of the browsers Job4me supports. The worker sends requests to the endpoint a
 * browser gives, so any other host is refused (no server-side request to an arbitrary address).
 */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
];
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function pushRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/api/push/public-key',
      { schema: { response: { 200: pushPublicKeyResponseSchema } } },
      async (request) => {
        requireSession(request);
        if (!deps.vapidPublicKey) throw new HttpError(503, 'push_not_configured');
        return { publicKey: deps.vapidPublicKey };
      },
    );

    app.get(
      '/api/push/subscriptions',
      { schema: { response: { 200: pushStatusResponseSchema } } },
      async (request) => {
        const session = requireSession(request);
        const [row] = await deps.db
          .select({ n: count() })
          .from(schema.pushSubscriptions)
          .where(eq(schema.pushSubscriptions.userId, session.userId));
        return { devices: row?.n ?? 0 };
      },
    );

    app.post(
      '/api/push/subscriptions',
      { schema: { body: pushSubscriptionSchema, response: { 200: okResponseSchema } } },
      async (request) => {
        const session = requireSession(request);
        const { endpoint, keys } = request.body;
        if (!isAllowedPushEndpoint(endpoint)) throw new HttpError(400, 'validation_error');
        // One endpoint is one browser: it moves to whoever subscribes it last.
        await deps.db
          .insert(schema.pushSubscriptions)
          .values({
            userId: session.userId,
            endpoint,
            p256dh: keys.p256dh,
            auth: keys.auth,
            userAgentLabel: userAgentLabel(request.headers['user-agent']),
          })
          .onConflictDoUpdate({
            target: schema.pushSubscriptions.endpoint,
            set: { userId: session.userId, p256dh: keys.p256dh, auth: keys.auth },
          });
        await recordAudit(deps.db, {
          actorType: 'user',
          actorUserId: session.userId,
          action: 'push.subscribed',
          outcome: 'success',
          requestId: request.id,
        });
        return { ok: true as const };
      },
    );

    app.delete(
      '/api/push/subscriptions',
      { schema: { body: pushUnsubscribeRequestSchema, response: { 200: okResponseSchema } } },
      async (request) => {
        const session = requireSession(request);
        await deps.db
          .delete(schema.pushSubscriptions)
          .where(
            and(
              eq(schema.pushSubscriptions.userId, session.userId),
              eq(schema.pushSubscriptions.endpoint, request.body.endpoint),
            ),
          );
        return { ok: true as const };
      },
    );

    app.post(
      '/api/push/test',
      {
        config: {
          rateLimit: {
            max: deps.config.settings.push.testRequestsPerMinute,
            timeWindow: '1 minute',
          },
        },
        schema: { response: { 200: okResponseSchema } },
      },
      async (request) => {
        const session = requireSession(request);
        if (!deps.queue || !deps.vapidPublicKey) throw new HttpError(503, 'push_not_configured');
        await deps.queue.send(QUEUES.pushTest, { userId: session.userId, requestId: request.id });
        return { ok: true as const };
      },
    );
  };
}
