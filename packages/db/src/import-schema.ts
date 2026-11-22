import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgRole,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { at, bytea, common, ownerPolicy } from './profile-schema';

// Imports (plan, sections 3 and 4; ADR 0010). The uploaded file itself is encrypted on disk under
// a random name; these tables only hold its description and the state of its extraction.

/** Role of the isolated extractor, created by the migration runner (never by drizzle-kit). */
export const extractorRole = pgRole('job4me_extractor').existing();

export const uploads = pgTable(
  'upload',
  {
    ...common(),
    /** Real type, detected from the content: cv_pdf, cv_docx or linkedin_zip. */
    kind: text('kind').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** SHA-256 of the file as uploaded, in hexadecimal. */
    sha256: text('sha256').notNull(),
    /** Random file name in the files volume (imports/<storage_key>). */
    storageKey: text('storage_key').notNull(),
  },
  (t) => [
    uniqueIndex('upload_storage_key_idx').on(t.storageKey),
    index('upload_user_id_idx').on(t.userId),
    check('upload_kind_check', sql`${t.kind} in ('cv_pdf', 'cv_docx', 'linkedin_zip')`),
    check('upload_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('upload_storage_key_check', sql`${t.storageKey} ~ '^[A-Za-z0-9_-]{43}$'`),
    ownerPolicy('upload'),
    // The extractor reads every queued upload (column privileges limit what it sees).
    pgPolicy('upload_extractor', { for: 'select', to: extractorRole, using: sql`true` }),
  ],
);

export const importRuns = pgTable(
  'import_run',
  {
    ...common(),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => uploads.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    errorCode: text('error_code'),
    /** Extractions started, so a file that crashes the extractor is given up after a few. */
    attempts: integer('attempts').notNull().default(0),
    claimedAt: at('claimed_at'),
    extractedAt: at('extracted_at'),
    /** Extracted text or rows: AES-256-GCM under the import key, bound to this row. */
    extracted: bytea('extracted'),
    /** Figures without content: pages, characters, rows per LinkedIn file. */
    stats: jsonb('stats').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('import_run_user_id_idx').on(t.userId, t.createdAt),
    index('import_run_pending_idx')
      .on(t.createdAt)
      .where(sql`status in ('queued', 'extracting')`),
    check(
      'import_run_status_check',
      sql`${t.status} in ('queued', 'extracting', 'extracted', 'structuring', 'review', 'applied', 'failed')`,
    ),
    check(
      'import_run_error_code_check',
      sql`${t.errorCode} is null or ${t.errorCode} in ('unsupported_file', 'file_too_large', 'file_too_complex', 'file_protected', 'file_macros', 'no_text', 'extraction_failed', 'extraction_timeout', 'ai_disabled', 'ai_cap_reached', 'ai_refused', 'ai_invalid_output', 'ai_failed')`,
    ),
    ownerPolicy('import_run'),
    pgPolicy('import_run_extractor_read', { for: 'select', to: extractorRole, using: sql`true` }),
    // The extractor only moves runs that are waiting or in extraction, and only to its own steps.
    pgPolicy('import_run_extractor_update', {
      for: 'update',
      to: extractorRole,
      using: sql`status in ('queued', 'extracting')`,
      withCheck: sql`status in ('extracting', 'extracted', 'failed')`,
    }),
  ],
);

export type Upload = typeof uploads.$inferSelect;
export type ImportRunRow = typeof importRuns.$inferSelect;
