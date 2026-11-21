import { and, desc, eq, type Executor, gt, isNull, ne, schema } from '@job4me/db';
import { randomToken, sha256 } from '@job4me/security';
import type { FastifyReply } from 'fastify';
import { baseCookieOptions, SESSION_COOKIE } from '../../cookies';
import type { SessionContext } from '../../request-context';
import { addMs } from './clock';

export type AuthMethod = SessionContext['authMethod'];

export interface SessionTimes {
  idleMs: number;
  absoluteMs: number;
}

/** Opens a session: the token goes to the cookie, only its SHA-256 goes to the database. */
export async function createSession(
  db: Executor,
  input: {
    userId: string;
    authMethod: AuthMethod;
    userAgentLabel: string | null;
    now: Date;
    times: SessionTimes;
  },
): Promise<{ token: string; id: string; absoluteExpiresAt: Date }> {
  const token = randomToken();
  const absoluteExpiresAt = addMs(input.now, input.times.absoluteMs);
  const [row] = await db
    .insert(schema.sessions)
    .values({
      userId: input.userId,
      tokenHash: sha256(token),
      authMethod: input.authMethod,
      lastSeenAt: input.now,
      idleExpiresAt: addMs(input.now, input.times.idleMs),
      absoluteExpiresAt,
      reauthenticatedAt: input.now,
      userAgentLabel: input.userAgentLabel,
    })
    .returning({ id: schema.sessions.id });
  return { token, id: row!.id, absoluteExpiresAt };
}

/** Finds the live session matching a cookie token, for an active user. */
export async function findLiveSession(db: Executor, token: string, now: Date) {
  const [row] = await db
    .select({
      id: schema.sessions.id,
      userId: schema.sessions.userId,
      authMethod: schema.sessions.authMethod,
      reauthenticatedAt: schema.sessions.reauthenticatedAt,
      createdAt: schema.sessions.createdAt,
      lastSeenAt: schema.sessions.lastSeenAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.tokenHash, sha256(token)),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.idleExpiresAt, now),
        gt(schema.sessions.absoluteExpiresAt, now),
        eq(schema.users.status, 'active'),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Records activity, which pushes back the inactivity deadline. */
export async function touchSession(db: Executor, id: string, now: Date, idleMs: number) {
  await db
    .update(schema.sessions)
    .set({ lastSeenAt: now, idleExpiresAt: addMs(now, idleMs) })
    .where(eq(schema.sessions.id, id));
}

/** New token after a re-authentication: the previous cookie stops working (session fixation). */
export async function rotateSession(db: Executor, id: string, now: Date): Promise<string> {
  const token = randomToken();
  await db
    .update(schema.sessions)
    .set({ tokenHash: sha256(token), reauthenticatedAt: now, lastSeenAt: now })
    .where(eq(schema.sessions.id, id));
  return token;
}

/** Revokes one session of one user; false when it does not belong to that user. */
export async function revokeSession(db: Executor, userId: string, id: string, now: Date) {
  const rows = await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.sessions.id, id),
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
      ),
    )
    .returning({ id: schema.sessions.id });
  return rows.length > 0;
}

export async function revokeOtherSessions(
  db: Executor,
  userId: string,
  keepId: string | null,
  now: Date,
): Promise<number> {
  const conditions = [eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)];
  if (keepId) conditions.push(ne(schema.sessions.id, keepId));
  const rows = await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(and(...conditions))
    .returning({ id: schema.sessions.id });
  return rows.length;
}

export function listLiveSessions(db: Executor, userId: string, now: Date) {
  return db
    .select({
      id: schema.sessions.id,
      authMethod: schema.sessions.authMethod,
      userAgentLabel: schema.sessions.userAgentLabel,
      createdAt: schema.sessions.createdAt,
      lastSeenAt: schema.sessions.lastSeenAt,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.idleExpiresAt, now),
        gt(schema.sessions.absoluteExpiresAt, now),
      ),
    )
    .orderBy(desc(schema.sessions.lastSeenAt));
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, { ...baseCookieOptions, expires: expiresAt });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, baseCookieOptions);
}
