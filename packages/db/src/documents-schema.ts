import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { common, ownerPolicy, targetJobs } from './profile-schema';

// Phase 4 documents (plan, section 3; ADR 0020): master CVs, documents and their versions. Every
// table belongs to one account (user_id and row-level security, ADR 0011). A version is written
// once and never changed: the application may add one, never rewrite or delete one.

/** The master CV of a target job: Mehdi's choices (order, hidden elements, summary). */
export const masterCvs = pgTable(
  'master_cv',
  {
    ...common(),
    targetJobId: uuid('target_job_id')
      .notNull()
      .references(() => targetJobs.id, { onDelete: 'cascade' }),
    template: text('template').notNull().default('classic'),
    language: text('language').notNull().default('fr'),
    /** { order, hidden, summary }: validated by masterCvLayoutSchema. */
    layout: jsonb('layout').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    uniqueIndex('master_cv_target_job_idx').on(t.targetJobId),
    index('master_cv_user_idx').on(t.userId),
    check('master_cv_template_check', sql`${t.template} in ('classic', 'modern')`),
    check('master_cv_language_check', sql`${t.language} in ('fr', 'nl', 'en')`),
    ownerPolicy('master_cv'),
  ],
);

/** A CV, a letter or a mail: of a master CV now, of an offer's dossier from lot 3. */
export const documents = pgTable(
  'document',
  {
    ...common(),
    masterCvId: uuid('master_cv_id').references(() => masterCvs.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** The version shown and exported. */
    currentVersion: integer('current_version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('document_master_cv_idx').on(t.masterCvId, t.kind),
    index('document_user_idx').on(t.userId),
    check('document_kind_check', sql`${t.kind} in ('cv', 'letter', 'mail')`),
    check('document_current_version_check', sql`${t.currentVersion} >= 1`),
    ownerPolicy('document'),
  ],
);

/** One version of a document: its JSON, the only source of its PDF and DOCX. */
export const documentVersions = pgTable(
  'document_version',
  {
    ...common(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    origin: text('origin').notNull(),
    /** Validated by documentContentSchema before it is written. */
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    uniqueIndex('document_version_number_idx').on(t.documentId, t.number),
    check('document_version_number_check', sql`${t.number} >= 1`),
    check(
      'document_version_origin_check',
      sql`${t.origin} in ('profile', 'layout', 'manual', 'template', 'claude')`,
    ),
    ownerPolicy('document_version'),
  ],
);

export type MasterCvRow = typeof masterCvs.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type DocumentVersionRow = typeof documentVersions.$inferSelect;
