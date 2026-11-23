import { type Database, eq, schema } from '@job4me/db';
import type { Logger } from '@job4me/logger';
import { sendNotification } from 'web-push';

// Web Push to every device of an account (SPEC section 10): the test notification, and the
// silent source alert of the collection (decision D4). Devices that left are forgotten.

export interface PushDeps {
  db: Database;
  logger: Logger;
  vapid: { subject: string; publicKey: string; privateKey: string };
  /** Injectable for tests; defaults to the web-push library. */
  send?: typeof sendNotification;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap leads, inside Job4me. */
  url: string;
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number(error.statusCode)
    : undefined;
}

export async function pushToUser(deps: PushDeps, userId: string, message: PushMessage) {
  const send = deps.send ?? sendNotification;
  const payload = JSON.stringify(message);
  const devices = await deps.db
    .select()
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, userId));
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
  return { devices: devices.length, delivered };
}
