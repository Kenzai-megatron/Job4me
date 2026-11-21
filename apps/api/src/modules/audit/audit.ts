import { and, desc, eq, type Executor, lt, schema } from '@job4me/db';

export type AuditOutcome = 'success' | 'failure' | 'denied';
export type AuditActor = 'user' | 'cli' | 'system';

/** One audit event. Metadata never holds personal data or secrets (SPEC section 11). */
export interface AuditEvent {
  actorType: AuditActor;
  actorUserId?: string | null;
  action: string;
  outcome: AuditOutcome;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export async function recordAudit(db: Executor, event: AuditEvent): Promise<void> {
  await db.insert(schema.auditLog).values({
    actorType: event.actorType,
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    outcome: event.outcome,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    requestId: event.requestId ?? null,
    metadata: event.metadata ?? {},
  });
}

/** Latest events of one user, newest first, for the Settings > Security screen. */
export function listAuditForUser(
  db: Executor,
  userId: string,
  options: { limit: number; beforeId?: number },
) {
  const conditions = [eq(schema.auditLog.actorUserId, userId)];
  if (options.beforeId !== undefined) conditions.push(lt(schema.auditLog.id, options.beforeId));
  return db
    .select({
      id: schema.auditLog.id,
      occurredAt: schema.auditLog.occurredAt,
      action: schema.auditLog.action,
      outcome: schema.auditLog.outcome,
      metadata: schema.auditLog.metadata,
    })
    .from(schema.auditLog)
    .where(and(...conditions))
    .orderBy(desc(schema.auditLog.id))
    .limit(options.limit);
}
