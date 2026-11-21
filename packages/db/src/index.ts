export {
  connect,
  type ConnectOptions,
  type Database,
  type DatabaseHandle,
  type Executor,
  type Transaction,
} from './client';
export { APP_ROLE, QUEUE_SCHEMA, runMigrations, type MigrateOptions } from './migrate';
export { MIGRATION_COUNT } from './migrations';
export * as schema from './schema';
export type { AuditEntry, AuthChallenge, Passkey, PushSubscription, Session, User } from './schema';
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
} from 'drizzle-orm';
