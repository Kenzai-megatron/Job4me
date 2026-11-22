import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Either the database or an open transaction: data-access functions accept both. */
export type Executor = Database | Transaction;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export interface ConnectOptions {
  /** Maximum pool size. */
  max?: number;
  applicationName?: string;
}

export function connect(connectionString: string, options: ConnectOptions = {}): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'job4me',
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}
