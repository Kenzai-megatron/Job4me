import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, {
  type FastifyBaseLogger,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import {
  type FastifyPluginAsyncZod,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppDeps } from './context';
import { registerCsrf } from './plugins/csrf';
import { registerErrorHandling } from './plugins/errors';
import { registerPreSession } from './plugins/pre-session';
import { registerSecurityHeaders } from './plugins/security-headers';
import { registerStatic } from './plugins/static';
import './request-context';
import { healthRoutes } from './routes/health';
import { accountRoutes } from './modules/auth/routes-account';
import { signInRoutes } from './modules/auth/routes-sign-in';
import { registerSessionHook } from './modules/auth/session-hook';
import { aiRoutes } from './modules/ai/routes';
import { offerRoutes } from './modules/collect/offers';
import { collectRoutes } from './modules/collect/routes';
import { reviewRoutes } from './modules/imports/review';
import { importRoutes } from './modules/imports/routes';
import { profileRoutes } from './modules/profile/routes';
import { pushRoutes } from './modules/push/routes';

export interface BuildOptions {
  /** Extra routes registered after the standard ones (tests only). */
  extraRoutes?: FastifyPluginAsyncZod;
}

export async function buildApp(deps: AppDeps, options: BuildOptions = {}) {
  const { config } = deps;
  const production = config.env === 'production';

  const base = Fastify<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    FastifyBaseLogger
  >({
    loggerInstance: deps.logger,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: config.settings.http.bodyLimitBytes,
    trustProxy: false,
  });
  base.setValidatorCompiler(validatorCompiler);
  base.setSerializerCompiler(serializerCompiler);

  if (!production) {
    await base.register(swagger, {
      openapi: { info: { title: 'Job4me API', version: '0.1.0' } },
      transform: jsonSchemaTransform,
    });
  }

  await registerSecurityHeaders(base, { production });
  await base.register(cookie);
  await base.register(rateLimit, { global: false });
  registerPreSession(base);
  registerSessionHook(base, deps);
  registerCsrf(base, { allowedOrigins: config.allowedOrigins, csrfKey: deps.keys.csrf });

  const spaFallback = await registerStatic(base, deps.webDistDir);
  registerErrorHandling(base, { spaFallback });

  const app = base.withTypeProvider<ZodTypeProvider>();
  await app.register(healthRoutes(deps));
  await app.register(signInRoutes(deps));
  await app.register(accountRoutes(deps));
  await app.register(pushRoutes(deps));
  await app.register(profileRoutes(deps));
  await app.register(importRoutes(deps));
  await app.register(reviewRoutes(deps));
  await app.register(aiRoutes(deps));
  await app.register(collectRoutes(deps));
  await app.register(offerRoutes(deps));
  if (!production) {
    app.get('/api/openapi.json', { schema: { hide: true } }, () => app.swagger());
  }
  if (options.extraRoutes) await app.register(options.extraRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
