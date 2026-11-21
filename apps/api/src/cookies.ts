import type { CookieSerializeOptions } from '@fastify/cookie';

// __Host- cookies: Secure, Path=/, no Domain, so no other host can set or read them (ADR 0003).
export const SESSION_COOKIE = '__Host-j4m_session';
export const PRE_SESSION_COOKIE = '__Host-j4m_pre';

export const baseCookieOptions: CookieSerializeOptions = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
};

/** A random 256-bit token in base64url, as issued by randomToken(). */
export function isTokenShaped(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}
