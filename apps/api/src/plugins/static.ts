import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Serves the built interface on the same origin as the API (ADR 0002). */
export async function registerStatic(
  app: FastifyInstance,
  webDistDir: string | undefined,
): Promise<boolean> {
  if (!webDistDir || !existsSync(join(webDistDir, 'index.html'))) return false;
  await app.register(fastifyStatic, {
    root: webDistDir,
    prefix: '/',
    // Routes are built once from the files on disk: no path is resolved at request time.
    wildcard: false,
    index: ['index.html'],
    dotfiles: 'deny',
    setHeaders(reply, path) {
      const hashedAsset = path.startsWith(join(webDistDir, 'assets'));
      reply.header(
        'cache-control',
        hashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  return true;
}
