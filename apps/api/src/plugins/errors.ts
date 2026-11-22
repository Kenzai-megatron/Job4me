import type { ErrorCode } from '@job4me/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { HttpError } from '../errors';

function send(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  error: ErrorCode,
  extra: { retryAfterSeconds?: number } = {},
) {
  if (extra.retryAfterSeconds !== undefined) {
    reply.header('retry-after', String(extra.retryAfterSeconds));
  }
  return reply.code(status).send({ error, requestId: request.id, ...extra });
}

const CLIENT_ERRORS: Record<string, { status: number; code: ErrorCode }> = {
  FST_ERR_CTP_BODY_TOO_LARGE: { status: 413, code: 'payload_too_large' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { status: 415, code: 'unsupported_media_type' },
  FST_ERR_CTP_EMPTY_JSON_BODY: { status: 400, code: 'invalid_body' },
  FST_ERR_CTP_INVALID_JSON_BODY: { status: 400, code: 'invalid_body' },
  // Uploads (@fastify/multipart): one file, nothing else.
  FST_REQ_FILE_TOO_LARGE: { status: 413, code: 'file_too_large' },
  FST_FILES_LIMIT: { status: 400, code: 'invalid_body' },
  FST_PARTS_LIMIT: { status: 400, code: 'invalid_body' },
  FST_FIELDS_LIMIT: { status: 400, code: 'invalid_body' },
  FST_PROTO_VIOLATION: { status: 400, code: 'invalid_body' },
  FST_MP_PREMATURE_CLOSE: { status: 400, code: 'invalid_body' },
  FST_INVALID_MULTIPART_CONTENT_TYPE: { status: 415, code: 'unsupported_media_type' },
};

/** Error messages never carry internal details (SPEC section 11). */
export function registerErrorHandling(
  app: FastifyInstance,
  options: { spaFallback: boolean },
): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof HttpError) {
      return send(reply, request, error.statusCode, error.code, error.extra);
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return send(reply, request, 400, 'validation_error');
    }
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'response does not match its schema');
      return send(reply, request, 500, 'internal_error');
    }
    if (error.statusCode === 429) {
      return send(reply, request, 429, 'rate_limited', { retryAfterSeconds: 60 });
    }
    const known = error.code ? CLIENT_ERRORS[error.code] : undefined;
    if (known) return send(reply, request, known.status, known.code);
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return send(reply, request, 400, 'invalid_body');
    }
    request.log.error({ err: error }, 'unhandled error');
    return send(reply, request, 500, 'internal_error');
  });

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    if (!isApi && options.spaFallback && request.method === 'GET') {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return send(reply, request, 404, 'not_found');
  });
}
