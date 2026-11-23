import type { PushTestJob } from '@job4me/contracts';
import { recordAudit } from '@job4me/db';
import { resources } from '@job4me/i18n';
import { type PushDeps, pushToUser } from '../notify';

export type { PushDeps } from '../notify';

/** Sends the test notification to every device of the user; forgets devices that left. */
export async function sendTestNotification(deps: PushDeps, job: PushTestJob) {
  const texts = resources.fr.translation.notifications;
  const result = await pushToUser(deps, job.userId, {
    title: texts.testTitle,
    body: texts.testBody,
    url: '/',
  });
  await recordAudit(deps.db, {
    actorType: 'system',
    actorUserId: job.userId,
    action: 'push.test_sent',
    outcome: result.delivered > 0 ? 'success' : 'failure',
    ...(job.requestId ? { requestId: job.requestId } : {}),
    metadata: { devices: result.devices, delivered: result.delivered },
  });
  return result;
}
