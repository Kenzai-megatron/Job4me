import journal from '../drizzle/meta/_journal.json' with { type: 'json' };

/** Number of migrations this build expects in the database (readiness check). */
export const MIGRATION_COUNT: number = journal.entries.length;
