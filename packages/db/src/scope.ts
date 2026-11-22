import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './client';

/**
 * Runs `work` in a transaction where row-level security shows only the rows of `userId`
 * (ADR 0011). The setting lives as long as the transaction: nothing leaks to the next request.
 */
export function withUser<T>(
  db: Database,
  userId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return work(tx);
  });
}
