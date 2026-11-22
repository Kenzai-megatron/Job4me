/** The signed-in session attached to a request, when there is one. */
export interface SessionContext {
  id: string;
  userId: string;
  authMethod: 'passkey' | 'password_totp' | 'password_recovery';
  reauthenticatedAt: Date;
  createdAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the session hook; null for anonymous requests. */
    session: SessionContext | null;
    /** Value of the pre-login cookie, which binds challenges and CSRF tokens before sign-in. */
    preSessionId: string | null;
  }
}
