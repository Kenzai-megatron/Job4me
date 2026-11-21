import type { PushTestJob } from '@job4me/contracts';
import { type Database, eq, recordAudit, schema } from '@job4me/db';
import { resources } from '@job4me/i18n';
import type { Logger } from '@job4me/logger';
import { sendNotification } from 'web-push';

export interface PushDeps {
  db: Database;
  logger: Logger;
  vapid: { subject: string; publicKey: string; privateKey: string };
  /** Injectable for tests; defaults to the web-push library. */
  send?: typeof sendNotification;
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number(error.statusCode)
    : undefined;
}

/** Sends the test notification to every device of the user; forgets devices that left. */
export async function sendTestNotification(deps: PushDeps, job: PushTestJob) {
  const send = deps.send ?? sendNotification;
  const texts = resources.fr.translation.notifications;
  const payload = JSON.stringify({ title: texts.testTitle, body: texts.testBody, url: '/' });
  const devices = await deps.db
    .select()
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, job.userId));

  let delivered = 0;
  for (const device of devices) {
    try {
      await send(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        payload,
        { vapidDetails: deps.vapid, TTL: 300, urgency: 'normal' },
      );
      delivered += 1;
      await deps.db
        .update(schema.pushSubscriptions)
        .set({ lastSuccessAt: new Date() })
        .where(eq(schema.pushSubscriptions.id, device.id));
    } catch (error) {
      const status = statusOf(error);
      if (status === 404 || status === 410) {
        // The browser unsubscribed or the subscription expired.
        await deps.db
          .delete(schema.pushSubscriptions)
          .where(eq(schema.pushSubscriptions.id, device.id));
      } else {
        deps.logger.warn({ status }, 'push delivery failed');
      }
    }
  }

  await recordAudit(deps.db, {
    actorType: 'system',
    actorUserId: job.userId,
    action: 'push.test_sent',
    outcome: delivered > 0 ? 'success' : 'failure',
    ...(job.requestId ? { requestId: job.requestId } : {}),
    metadata: { devices: devices.length, delivered },
  });
  return { devices: devices.length, delivered };
}
