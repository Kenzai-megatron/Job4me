export {
  connect,
  type ConnectOptions,
  type Database,
  type DatabaseHandle,
  type Executor,
  type Transaction,
} from './client';
export {
  type AuditActor,
  type AuditEvent,
  type AuditOutcome,
  listAuditForUser,
  recordAudit,
} from './audit';
export {
  APP_ROLE,
  EXTRACTOR_ROLE,
  QUEUE_SCHEMA,
  runMigrations,
  type MigrateOptions,
} from './migrate';
export { MIGRATION_COUNT } from './migrations';
export { queueOptions } from './queue';
export { withUser } from './scope';
export * as schema from './schema';
export type {
  AuditEntry,
  AuthChallenge,
  ImportRunRow,
  Passkey,
  Profile,
  PushSubscription,
  Session,
  Upload,
  User,
} from './schema';
// Query helpers re-exported so every package uses this single drizzle-orm instance.
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
