// Background jobs the API asks the worker to run (pg-boss queues).
export const QUEUES = {
  pushTest: 'push_test',
  maintenancePurge: 'maintenance_purge',
} as const;

export interface PushTestJob {
  userId: string;
  requestId?: string;
}
