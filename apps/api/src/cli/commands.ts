import type { Config } from '@job4me/config';
import { desc, type Executor, schema } from '@job4me/db';
import { recordAudit } from '@job4me/db';
import { revokeOtherSessions } from '../modules/auth/sessions';
import {
  createUser,
  enrollmentLink,
  findUserByEmail,
  issueEnrollmentToken,
} from '../modules/auth/users';

export class CliError extends Error {
  override name = 'CliError';
}

function enrollmentValidityMs(config: Config) {
  return config.settings.auth.enrollmentLinkMinutes * 60_000;
}

/** `user:create`: the only way to create an account (no public sign-up). */
export async function userCreate(
  db: Executor,
  config: Config,
  input: { email: string; name: string; password: string; now?: Date },
) {
  if (await findUserByEmail(db, input.email)) {
    throw new CliError('Un compte existe déjà pour cette adresse.');
  }
  const now = input.now ?? new Date();
  const user = await createUser(db, {
    email: input.email,
    displayName: input.name,
    password: input.password,
    settings: config.settings,
  });
  const { token, expiresAt } = await issueEnrollmentToken(db, {
    userId: user.id,
    now,
    validityMs: enrollmentValidityMs(config),
  });
  await recordAudit(db, {
    actorType: 'cli',
    actorUserId: user.id,
    action: 'user.created',
    outcome: 'success',
  });
  await recordAudit(db, {
    actorType: 'cli',
    actorUserId: user.id,
    action: 'enrollment.link_issued',
    outcome: 'success',
  });
  return {
    userId: user.id,
    link: enrollmentLink(config.settings.app.publicOrigin, token),
    expiresAt,
  };
}

/** `user:enroll-link`: a new link when every way in is lost; older links stop working. */
export async function userEnrollLink(
  db: Executor,
  config: Config,
  input: { email: string; now?: Date },
) {
  const user = await findUserByEmail(db, input.email);
  if (!user) throw new CliError('Aucun compte pour cette adresse.');
  const { token, expiresAt } = await issueEnrollmentToken(db, {
    userId: user.id,
    now: input.now ?? new Date(),
    validityMs: enrollmentValidityMs(config),
  });
  await recordAudit(db, {
    actorType: 'cli',
    actorUserId: user.id,
    action: 'enrollment.link_issued',
    outcome: 'success',
  });
  return { link: enrollmentLink(config.settings.app.publicOrigin, token), expiresAt };
}

/** `sessions:revoke-all`: signs the account out everywhere. */
export async function sessionsRevokeAll(db: Executor, input: { email: string; now?: Date }) {
  const user = await findUserByEmail(db, input.email);
  if (!user) throw new CliError('Aucun compte pour cette adresse.');
  const revoked = await revokeOtherSessions(db, user.id, null, input.now ?? new Date());
  await recordAudit(db, {
    actorType: 'cli',
    actorUserId: user.id,
    action: 'sessions.revoked_all',
    outcome: 'success',
    metadata: { count: revoked },
  });
  return revoked;
}

/** `audit:tail`: the latest events, every account included. */
export function auditTail(db: Executor, limit: number) {
  return db
    .select({
      id: schema.auditLog.id,
      occurredAt: schema.auditLog.occurredAt,
      actorType: schema.auditLog.actorType,
      action: schema.auditLog.action,
      outcome: schema.auditLog.outcome,
      metadata: schema.auditLog.metadata,
    })
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.id))
    .limit(limit);
}
