import { healthResponseSchema } from '@job4me/contracts';
import { MIGRATION_COUNT, sql } from '@job4me/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../context';
import { HttpError } from '../errors';

export function healthRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  return async (app) => {
    // Liveness: the process answers.
    app.get('/api/health', { schema: { response: { 200: healthResponseSchema } } }, () => ({
      status: 'ok' as const,
    }));

    // Readiness: the database answers and every migration is applied.
    app.get('/api/ready', { schema: { response: { 200: healthResponseSchema } } }, async () => {
      let applied: number;
      try {
        const result = await deps.db.execute<{ n: number }>(
          sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
        );
        applied = result.rows[0]?.n ?? 0;
      } catch {
        throw new HttpError(503, 'database_unavailable');
      }
      if (applied < MIGRATION_COUNT) throw new HttpError(503, 'migrations_pending');
      return { status: 'ok' as const };
    });
  };
}
