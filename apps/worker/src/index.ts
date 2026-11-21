import { loadConfig, loadSecrets } from '@job4me/config';
import { type PushTestJob, QUEUES } from '@job4me/contracts';
import { connect, queueOptions } from '@job4me/db';
import { createLogger } from '@job4me/logger';
import { PgBoss } from 'pg-boss';
import { purgeExpired } from './jobs/purge';
import { sendTestNotification } from './jobs/push-test';

// The worker runs background jobs from the PostgreSQL queue (SPEC section 10).

async function ensureQueue(boss: PgBoss, name: string) {
  if (!(await boss.getQueue(name))) await boss.createQueue(name);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const secrets = loadSecrets();
  const logger = createLogger({ name: 'worker' });
  const database = connect(secrets.databaseUrl, { applicationName: 'job4me-worker', max: 5 });
  const boss = new PgBoss({ ...queueOptions(secrets.databaseUrl), max: 4 });
  boss.on('error', (error) => logger.error({ err: error }, 'queue error'));
  await boss.start();

  await ensureQueue(boss, QUEUES.pushTest);
  await ensureQueue(boss, QUEUES.maintenancePurge);
  await boss.schedule(QUEUES.maintenancePurge, config.settings.worker.purgeCron, null, {
    tz: 'Europe/Brussels',
  });

  const vapid =
    secrets.vapidPublicKey && secrets.vapidPrivateKey
      ? {
          subject: config.settings.push.vapidSubject,
          publicKey: secrets.vapidPublicKey,
          privateKey: secrets.vapidPrivateKey,
        }
      : null;

  await boss.work<PushTestJob>(QUEUES.pushTest, async (jobs) => {
    if (!vapid) {
      logger.warn('push keys missing: test notification skipped');
      return;
    }
    for (const job of jobs) {
      const result = await sendTestNotification({ db: database.db, logger, vapid }, job.data);
      logger.info(result, 'test notification sent');
    }
  });

  await boss.work(QUEUES.maintenancePurge, async () => {
    const result = await purgeExpired(database.db, config.settings);
    logger.info(result, 'expired records purged');
  });

  logger.info('worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await boss.stop({ graceful: true });
    await database.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  process.stderr.write(
    `worker failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
