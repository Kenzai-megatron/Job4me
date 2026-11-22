import type { ErrorCode } from '@job4me/contracts';

/** An API refusal, carrying the stable code the interface translates. */
export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network' | 'passkey_cancelled',
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

let csrfToken = '';

/** The token comes from GET /api/auth/session and from every sign-in response. */
export function setCsrfToken(token: string) {
  csrfToken = token;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(method === 'GET'
          ? {}
          : { 'content-type': 'application/json', 'x-csrf-token': csrfToken }),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: ErrorCode;
      retryAfterSeconds?: number;
    };
    throw new ApiError(response.status, data.error ?? 'internal_error', data.retryAfterSeconds);
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
