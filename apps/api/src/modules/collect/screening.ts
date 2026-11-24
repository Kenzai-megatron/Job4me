import { QUEUES } from '@job4me/contracts';
import type { AppDeps } from '../../context';

// The deterministic filter runs in the worker (phase 3 plan, section 6): when the criteria of an
// account change (radius, base city, contracts, remote work, excluded employers, elimination
// rules), the API asks it to read every offer of the account again.

export async function requestScreening(deps: AppDeps, userId: string): Promise<void> {
  if (!deps.queue) return;
  await deps.queue.send(QUEUES.offersScreen, { userId });
}
