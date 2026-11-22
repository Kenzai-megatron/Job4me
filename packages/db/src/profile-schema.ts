import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  index,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './schema';

// Phase 1 profile (plan, section 3; SPEC section 4). Every table belongs to one user and is
// guarded twice (ADR 0011): the user_id filter of each query, and row-level security that only
// shows the rows of the user set in the transaction parameter app.user_id.

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const at = (name: string) => timestamp(name, { withTimezone: true });

/** The row belongs to the user of the current transaction (no parameter: no row). */
export const OWNED_BY_CURRENT_USER = sql`user_id = nullif(current_setting('app.user_id', true), '')::uuid`;

const ownerPolicy = (table: string) =>
  pgPolicy(`${table}_owner`, {
    for: 'all',
    to: 'public',
    using: OWNED_BY_CURRENT_USER,
    withCheck: OWNED_BY_CURRENT_USER,
  });

const common = () => ({
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
});

/** Months travel and are stored as YYYY-MM. */
const month = (name: string) => text(name);
const monthCheck = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} is null or ${column} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`);

export const profiles = pgTable(
  'profile',
  {
    ...common(),
    motivations: text('motivations'),
    motivationTags: text('motivation_tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    baseCity: text('base_city'),
    basePostalCode: text('base_postal_code'),
    radiusKm: integer('radius_km'),
    contractTypes: text('contract_types')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    workRegimes: text('work_regimes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    remotePreference: text('remote_preference'),
    salaryMinMonthly: integer('salary_min_monthly'),
    availableFrom: text('available_from'),
  },
  (t) => [uniqueIndex('profile_user_id_idx').on(t.userId), ownerPolicy('profile')],
);

/** Identity and contact details, encrypted as one JSON document (never sent to the AI). */
export const profileIdentities = pgTable(
  'profile_identity',
  {
    ...common(),
    ciphertext: bytea('ciphertext').notNull(),
  },
  (t) => [
    uniqueIndex('profile_identity_user_id_idx').on(t.userId),
    ownerPolicy('profile_identity'),
  ],
);

export const targetJobs = pgTable(
  'target_job',
  {
    ...common(),
    title: text('title').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('target_job_user_id_idx').on(t.userId), ownerPolicy('target_job')],
);

export const searchKeywords = pgTable(
  'search_keyword',
  {
    ...common(),
    keyword: text('keyword').notNull(),
    language: text('language').notNull(),
    priority: boolean('priority').notNull().default(false),
    origin: text('origin').notNull().default('manual'),
    status: text('status').notNull().default('validated'),
  },
  (t) => [
    uniqueIndex('search_keyword_unique_idx').on(t.userId, t.language, sql`lower(${t.keyword})`),
    check('search_keyword_language_check', sql`${t.language} in ('fr', 'nl', 'en')`),
    check('search_keyword_origin_check', sql`${t.origin} in ('ai', 'manual', 'import')`),
    check('search_keyword_status_check', sql`${t.status} in ('proposed', 'validated', 'rejected')`),
    ownerPolicy('search_keyword'),
  ],
);

export const sectorPreferences = pgTable(
  'sector_preference',
  {
    ...common(),
    sector: text('sector').notNull(),
    kind: text('kind').notNull(),
  },
  (t) => [
    index('sector_preference_user_id_idx').on(t.userId),
    check('sector_preference_kind_check', sql`${t.kind} in ('preferred', 'accepted', 'excluded')`),
    ownerPolicy('sector_preference'),
  ],
);

export const skills = pgTable(
  'skill',
  {
    ...common(),
    name: text('name').notNull(),
    level: text('level'),
    years: numeric('years', { precision: 4, scale: 1, mode: 'number' }),
  },
  (t) => [
    index('skill_user_id_idx').on(t.userId),
    check(
      'skill_level_check',
      sql`${t.level} is null or ${t.level} in ('beginner', 'intermediate', 'advanced', 'expert')`,
    ),
    ownerPolicy('skill'),
  ],
);

/** A CEFR level (A1 to C2), or no value when the column allows it. */
const cefrCheck = (name: string, column: AnyPgColumn, optional: boolean) =>
  optional
    ? check(name, sql`${column} is null or ${column} in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')`)
    : check(name, sql`${column} in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')`);

export const languageLevels = pgTable(
  'language_level',
  {
    ...common(),
    language: text('language').notNull(),
    overall: text('overall').notNull(),
    understanding: text('understanding'),
    speaking: text('speaking'),
    writing: text('writing'),
  },
  (t) => [
    uniqueIndex('language_level_unique_idx').on(t.userId, t.language),
    cefrCheck('language_level_overall_check', t.overall, false),
    cefrCheck('language_level_understanding_check', t.understanding, true),
    cefrCheck('language_level_speaking_check', t.speaking, true),
    cefrCheck('language_level_writing_check', t.writing, true),
    ownerPolicy('language_level'),
  ],
);

export const experiences = pgTable(
  'experience',
  {
    ...common(),
    title: text('title').notNull(),
    employer: text('employer').notNull(),
    location: text('location'),
    startMonth: month('start_month'),
    endMonth: month('end_month'),
    current: boolean('current').notNull().default(false),
    description: text('description'),
  },
  (t) => [
    index('experience_user_id_idx').on(t.userId),
    monthCheck('experience_start_month_check', t.startMonth),
    monthCheck('experience_end_month_check', t.endMonth),
    ownerPolicy('experience'),
  ],
);

/** A reusable achievement: the only material future CVs and letters may draw on. */
export const facts = pgTable(
  'fact',
  {
    ...common(),
    experienceId: uuid('experience_id').references(() => experiences.id, { onDelete: 'set null' }),
    text: text('text').notNull(),
    origin: text('origin').notNull().default('manual'),
  },
  (t) => [
    index('fact_user_id_idx').on(t.userId),
    check('fact_origin_check', sql`${t.origin} in ('manual', 'cv_import', 'linkedin_import')`),
    ownerPolicy('fact'),
  ],
);

export const educations = pgTable(
  'education',
  {
    ...common(),
    degree: text('degree').notNull(),
    institution: text('institution').notNull(),
    year: integer('year'),
  },
  (t) => [index('education_user_id_idx').on(t.userId), ownerPolicy('education')],
);

export const certifications = pgTable(
  'certification',
  {
    ...common(),
    name: text('name').notNull(),
    issuer: text('issuer'),
    year: integer('year'),
  },
  (t) => [index('certification_user_id_idx').on(t.userId), ownerPolicy('certification')],
);

export const eliminationRules = pgTable(
  'elimination_rule',
  {
    ...common(),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
  },
  (t) => [
    index('elimination_rule_user_id_idx').on(t.userId),
    check(
      'elimination_rule_kind_check',
      sql`${t.kind} in ('language', 'sector', 'schedule', 'travel', 'other')`,
    ),
    ownerPolicy('elimination_rule'),
  ],
);

export const titleFilterRules = pgTable(
  'title_filter_rule',
  {
    ...common(),
    list: text('list').notNull(),
    expression: text('expression').notNull(),
  },
  (t) => [
    index('title_filter_rule_user_id_idx').on(t.userId),
    check('title_filter_rule_list_check', sql`${t.list} in ('keep', 'reject', 'always')`),
    ownerPolicy('title_filter_rule'),
  ],
);

export const excludedCompanies = pgTable(
  'excluded_company',
  {
    ...common(),
    name: text('name').notNull(),
    reason: text('reason'),
  },
  (t) => [index('excluded_company_user_id_idx').on(t.userId), ownerPolicy('excluded_company')],
);

export type Profile = typeof profiles.$inferSelect;
