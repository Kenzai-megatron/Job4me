import { sql } from 'drizzle-orm';
import { doublePrecision, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { at } from './profile-schema';

// Geography (phase 3 plan, section 5; ADR 0017). Public data common to every account, loaded by
// the migration from the versioned GeoNames file: no user_id, no row-level security, read only
// for the application role.

/** A Belgian locality of GeoNames: its name, its other names, postal codes and coordinates. */
export const localities = pgTable(
  'locality',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    /** French, Dutch, German and English names: Malines for Mechelen, Elsene for Ixelles. */
    names: text('names')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    postalCodes: text('postal_codes').array().notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    /** BRU, VLG or WAL. */
    region: text('region').notNull(),
    province: text('province').notNull(),
  },
  (t) => [index('locality_name_idx').on(t.name)],
);

/** The version of each data file loaded by the migration (its SHA-256). */
export const datasets = pgTable('dataset', {
  name: text('name').primaryKey(),
  sha256: text('sha256').notNull(),
  rows: integer('rows').notNull(),
  loadedAt: at('loaded_at').notNull().defaultNow(),
});

export type LocalityRecord = typeof localities.$inferSelect;
