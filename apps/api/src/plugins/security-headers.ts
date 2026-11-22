import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

// Strict browser policy (SPEC section 11, ADR 0002): the interface is plain static files,
// so no inline script, no third-party origin, no framing.
const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'bluetooth=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'serial=()',
  'usb=()',
  'publickey-credentials-create=(self)',
  'publickey-credentials-get=(self)',
].join(', ');

export async function registerSecurityHeaders(
  app: FastifyInstance,
  options: { production: boolean },
): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: options.production ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: options.production
      ? { maxAge: 63_072_000, includeSubDomains: false, preload: false }
      : false,
    xFrameOptions: { action: 'deny' },
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('permissions-policy', PERMISSIONS_POLICY);
    reply.header('x-request-id', request.id);
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });
}
