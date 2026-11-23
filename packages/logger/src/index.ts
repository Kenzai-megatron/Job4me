import { pino, type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

/** Query parameters whose values never reach a log (SPEC section 11, SOURCES section 0). */
const SENSITIVE_PARAMS = new Set([
  'api_key',
  'app_id',
  'app_key',
  'apikey',
  'key',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'code',
  'password',
  'secret',
  'signature',
  'sig',
  't',
]);

/** Masks secret query parameters and drops the fragment of a URL before it is logged. */
export function maskUrl(input: string): string {
  const hashIndex = input.indexOf('#');
  const withoutFragment = hashIndex === -1 ? input : input.slice(0, hashIndex);
  const queryIndex = withoutFragment.indexOf('?');
  if (queryIndex === -1) return withoutFragment;
  const base = withoutFragment.slice(0, queryIndex);
  const masked = withoutFragment
    .slice(queryIndex + 1)
    .split('&')
    .map((pair) => {
      const equals = pair.indexOf('=');
      const name = decodeURIComponent((equals === -1 ? pair : pair.slice(0, equals)).toLowerCase());
      return SENSITIVE_PARAMS.has(name) && equals !== -1
        ? `${pair.slice(0, equals)}=[redacted]`
        : pair;
    })
    .join('&');
  return `${base}?${masked}`;
}

/** Paths removed from every log line: credentials, codes and personal data. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',
  'req.headers["x-api-key"]',
  'apiKey',
  '*.apiKey',
  'password',
  '*.password',
  'newPassword',
  '*.newPassword',
  'currentPassword',
  '*.currentPassword',
  'token',
  '*.token',
  'code',
  '*.code',
  'secret',
  '*.secret',
  'masterKey',
  '*.masterKey',
  'email',
  '*.email',
  'response',
  '*.response',
  'subscription',
  '*.subscription',
];

interface SerializedRequest {
  method?: string;
  url?: string;
  id?: string;
}

export interface CreateLoggerOptions {
  name: string;
  level?: LoggerOptions['level'];
  /** Where to write; defaults to standard output. Tests pass a stream to inspect lines. */
  destination?: NodeJS.WritableStream;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const config: LoggerOptions = {
    name: options.name,
    level: options.level ?? process.env.JOB4ME_LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      req(req: SerializedRequest) {
        return { method: req.method, url: req.url ? maskUrl(req.url) : undefined, id: req.id };
      },
      err: pino.stdSerializers.err,
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}
