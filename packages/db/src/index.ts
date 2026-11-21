export {
  connect,
  type ConnectOptions,
  type Database,
  type DatabaseHandle,
  type Executor,
  type Transaction,
} from './client';
export { APP_ROLE, QUEUE_SCHEMA, runMigrations, type MigrateOptions } from './migrate';
export * as schema from './schema';
export type { AuditEntry, AuthChallenge, Passkey, PushSubscription, Session, User } from './schema';
