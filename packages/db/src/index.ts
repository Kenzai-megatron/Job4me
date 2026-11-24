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
export {
  LOCALITIES_SHA256,
  loadLocalities,
  type LocalityRow,
  parseLocalities,
  readLocalities,
} from './localities';
export { MIGRATION_COUNT } from './migrations';
export {
  createOffers,
  findHistoryPostings,
  type HistoryPosting,
  type OfferGeo,
  refreshOffers,
  updateDistances,
} from './offers';
export { queueOptions } from './queue';
export { withUser } from './scope';
export * as schema from './schema';
export type {
  AiCall,
  AuditEntry,
  AuthChallenge,
  CollectionPassRow,
  DocumentRow,
  DocumentVersionRow,
  JobOfferRow,
  ImportProposal,
  ImportRunRow,
  KeywordProposalRun,
  MasterCvRow,
  OfferRow,
  OfferRatingRow,
  OfferScoreRow,
  ScoringBenchmarkRow,
  Passkey,
  Profile,
  PushSubscription,
  Session,
  SourceRunRow,
  SourceSettingRow,
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
export { alias } from 'drizzle-orm/pg-core';
