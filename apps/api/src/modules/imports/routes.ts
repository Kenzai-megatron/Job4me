import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import multipart from '@fastify/multipart';
import {
  type ErrorCode,
  type ImportErrorCode,
  importIdParamsSchema,
  importListSchema,
  type ImportRun,
  importRunSchema,
  importStatsSchema,
} from '@job4me/contracts';
import {
  and,
  desc,
  eq,
  recordAudit,
  schema,
  type SQL,
  type Transaction,
  withUser,
} from '@job4me/db';
import { detectImport, ImportError, storagePath, uploadAad } from '@job4me/imports';
import { encrypt, randomToken, sha256 } from '@job4me/security';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../context';
import { HttpError } from '../../errors';
import { requireSession } from '../auth/guards';

// Imports (phase 1 plan, sections 4 and 8; ADR 0010). The API only checks the real type and the
// bounds of the file, encrypts it under the import key and queues it: reading its content is
// the isolated extractor's job.

/** The answer to a file refused at upload: status and translated code. */
function refusal(code: ImportErrorCode): { status: number; code: ErrorCode } {
  switch (code) {
    case 'file_too_large':
      return { status: 413, code };
    case 'file_too_complex':
    case 'file_protected':
    case 'file_macros':
      return { status: 422, code };
    default:
      return { status: 415, code: 'unsupported_file' };
  }
}

const runColumns = {
  id: schema.importRuns.id,
  status: schema.importRuns.status,
  errorCode: schema.importRuns.errorCode,
  stats: schema.importRuns.stats,
  createdAt: schema.importRuns.createdAt,
  updatedAt: schema.importRuns.updatedAt,
  kind: schema.uploads.kind,
  sizeBytes: schema.uploads.sizeBytes,
};

/** Import runs of one user with their upload; `extra` narrows them down. */
function selectRuns(tx: Transaction, userId: string, extra?: SQL) {
  const own = eq(schema.importRuns.userId, userId);
  return tx
    .select(runColumns)
    .from(schema.importRuns)
    .innerJoin(schema.uploads, eq(schema.uploads.id, schema.importRuns.uploadId))
    .where(extra ? and(own, extra) : own);
}

type RunRow = Awaited<ReturnType<typeof selectRuns>>[number];

function toRun(row: RunRow): ImportRun {
  return importRunSchema.parse({
    ...row,
    stats: row.stats ? importStatsSchema.parse(row.stats) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function importRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  const limits = deps.config.settings.imports;
  const { key, filesDir } = deps.imports;

  return async (app) => {
    // Registered here only: no other route accepts multipart bodies.
    await app.register(multipart, {
      limits: {
        fileSize: limits.maxFileBytes,
        files: 1,
        fields: 0,
        parts: 1,
        headerPairs: 50,
      },
    });

    app.post(
      '/api/imports',
      {
        config: { rateLimit: { max: limits.uploadsPerHour, timeWindow: '1 hour' } },
        schema: { response: { 200: importRunSchema } },
      },
      async (request) => {
        const { userId } = requireSession(request);
        // Exactly one part, a file: a second part or any field is refused (limits above).
        let content: Buffer | undefined;
        for await (const part of request.parts()) {
          if (part.type !== 'file' || content) throw new HttpError(400, 'invalid_body');
          content = await part.toBuffer();
        }
        if (!content) throw new HttpError(400, 'invalid_body');

        let kind;
        try {
          kind = await detectImport(content, limits.archive);
        } catch (error) {
          if (!(error instanceof ImportError)) throw error;
          request.log.info({ reason: error.code, size: content.length }, 'upload refused');
          const { status, code } = refusal(error.code);
          throw new HttpError(status, code);
        }

        const storageKey = randomToken(32);
        const path = storagePath(filesDir, storageKey);
        const run = await withUser(deps.db, userId, async (tx) => {
          const [upload] = await tx
            .insert(schema.uploads)
            .values({
              userId,
              kind,
              sizeBytes: content.length,
              sha256: sha256(content).toString('hex'),
              storageKey,
            })
            .returning({ id: schema.uploads.id });
          // Written inside the transaction: if the row is not saved, the file is removed.
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          await writeFile(path, encrypt(key, content, uploadAad(upload!.id)), {
            mode: 0o600,
            flag: 'wx',
          });
          try {
            const [created] = await tx
              .insert(schema.importRuns)
              .values({ userId, uploadId: upload!.id })
              .returning({ id: schema.importRuns.id });
            await recordAudit(tx, {
              actorType: 'user',
              actorUserId: userId,
              action: 'import.uploaded',
              outcome: 'success',
              requestId: request.id,
              metadata: { kind, sizeBytes: content.length },
            });
            const [row] = await selectRuns(tx, userId, eq(schema.importRuns.id, created!.id));
            return row!;
          } catch (error) {
            await unlink(path).catch(() => undefined);
            throw error;
          }
        });
        request.log.info({ importRunId: run.id, kind }, 'import queued');
        return toRun(run);
      },
    );

    app.get(
      '/api/imports',
      { schema: { response: { 200: importListSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const rows = await withUser(deps.db, userId, (tx) =>
          selectRuns(tx, userId).orderBy(desc(schema.importRuns.createdAt)).limit(limits.listLimit),
        );
        return { items: rows.map(toRun) };
      },
    );

    app.get(
      '/api/imports/:id',
      { schema: { params: importIdParamsSchema, response: { 200: importRunSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const [row] = await withUser(deps.db, userId, (tx) =>
          selectRuns(tx, userId, eq(schema.importRuns.id, request.params.id)),
        );
        if (!row) throw new HttpError(404, 'not_found');
        return toRun(row);
      },
    );
  };
}
