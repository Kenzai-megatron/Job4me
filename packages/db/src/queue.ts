import { QUEUE_SCHEMA } from './migrate';

/**
 * pg-boss settings shared by the API, the worker and their tests. The migrations create the queue
 * schema, owned by the runtime role, and pg-boss installs or upgrades its own tables inside it.
 * createSchema stays off: PostgreSQL checks CREATE SCHEMA IF NOT EXISTS against a database
 * privilege that the runtime role does not have, even when the schema already exists.
 */
export function queueOptions(connectionString: string) {
  return { connectionString, schema: QUEUE_SCHEMA, createSchema: false } as const;
}
