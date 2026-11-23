import { assertSourceSettings, availableConnectors } from '@job4me/collect';
import { loadConfig, loadSecrets } from '@job4me/config';
import {
  type CollectPassJob,
  type KeywordsProposeJob,
  type PushTestJob,
  QUEUES,
} from '@job4me/contracts';
import { connect, queueOptions } from '@job4me/db';
import { createLogger } from '@job4me/logger';
import { deriveKey, parseKey, parseMasterKey } from '@job4me/security';
import { PgBoss } from 'pg-boss';
import { createAiService } from './ai/service';
import { runPass } from './collect/pass';
import { purgeCollection, schedulePasses } from './collect/schedule';
import { proposeKeywords } from './jobs/keywords';
import { purgeExpired, purgeImports } from './jobs/purge';
import { sendTestNotification } from './jobs/push-test';
import { startStructurer } from './jobs/structurer';

// The worker runs background jobs from the PostgreSQL queue (SPEC section 10).

async function ensureQueue(
  boss: PgBoss,
  name: string,
  options?: { expireInSeconds: number; retryLimit: number },
) {
  if (!(await boss.getQueue(name))) await boss.createQueue(name, options);
  else if (options) await boss.updateQueue(name, options);
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
  await ensureQueue(boss, QUEUES.keywordsPropose);
  await boss.schedule(QUEUES.maintenancePurge, config.settings.worker.purgeCron, null, {
    tz: 'Europe/Brussels',
  });

  // Collection (ADR 0013): a pass is never retried by the queue (a private person's pace), and
  // may run as long as its budget before the queue considers it lost.
  assertSourceSettings(config.settings);
  const connectors = availableConnectors(config.settings);
  const { collect } = config.settings;
  await ensureQueue(boss, QUEUES.collectSchedule);
  await ensureQueue(boss, QUEUES.collectPass, {
    expireInSeconds: Math.ceil(collect.staleAfterMs / 1000),
    retryLimit: 0,
  });
  await boss.schedule(QUEUES.collectSchedule, collect.schedule.cron, null, {
    tz: collect.schedule.timeZone,
  });
  const collectDeps = {
    db: database.db,
    settings: config.settings,
    logger,
    connectors,
    // Adzuna and SerpApi keys arrive with their connectors (phase 2, lot 2; decision D2).
    secrets: {},
  };
  await boss.work(QUEUES.collectSchedule, async () => {
    await schedulePasses({
      ...collectDeps,
      queue: { send: (name, data) => boss.send(name, data) },
    });
  });
  // One pass at a time (localConcurrency 1): never two calls to the same site at once.
  await boss.work<CollectPassJob>(QUEUES.collectPass, async (jobs) => {
    for (const job of jobs) await runPass(collectDeps, job.data);
  });
  logger.info({ sources: connectors.map((connector) => connector.name) }, 'collection ready');

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
    const imports = await purgeImports(database.db, config.settings);
    const collected = await purgeCollection(database.db, config.settings);
    logger.info({ ...result, ...imports, ...collected }, 'expired records purged');
  });

  // Claude API (ADR 0009): without a key, every AI step answers "not configured".
  const ai = createAiService({
    db: database.db,
    settings: config.settings,
    logger,
    apiKey: secrets.anthropicApiKey,
  });
  logger.info({ enabled: ai.enabled }, 'claude api');
  await boss.work<KeywordsProposeJob>(QUEUES.keywordsPropose, async (jobs) => {
    for (const job of jobs) {
      await proposeKeywords({ db: database.db, ai, settings: config.settings, logger }, job.data);
    }
  });

  const structurer = secrets.importKey
    ? startStructurer({
        db: database.db,
        ai,
        settings: config.settings,
        importKey: parseKey(secrets.importKey, 'import key'),
        identityKey: deriveKey(parseMasterKey(secrets.masterKey), 'identity'),
        logger,
      })
    : null;
  if (!structurer) logger.warn('import key missing: CV imports are not structured (pnpm setup:*)');

  logger.info('worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await structurer?.stop();
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
