import { assertSourceSettings, availableConnectors, Gazetteer } from '@job4me/collect';
import { loadConfig, loadSecrets } from '@job4me/config';
import {
  type CollectPassJob,
  type KeywordsProposeJob,
  type OffersAiScoreJob,
  type OffersScreenJob,
  type PushTestJob,
  QUEUES,
  type ScoringBenchmarkJob,
} from '@job4me/contracts';
import { connect, queueOptions, readLocalities, withUser } from '@job4me/db';
import { createLogger } from '@job4me/logger';
import { deriveKey, parseKey, parseMasterKey } from '@job4me/security';
import { PgBoss } from 'pg-boss';
import { createAiService } from './ai/service';
import { runBenchmark } from './collect/benchmark';
import { scoreWithClaude } from './collect/claude';
import { runPass } from './collect/pass';
import { prepareStoredPostings } from './collect/postings';
import { screenOffers, screenProfileOf } from './collect/screen';
import { scoreOffers, scoringContextOf } from './collect/scoring';
import { purgeCollection, schedulePasses } from './collect/schedule';
import { alertTopOffers } from './collect/top-offers';
import { proposeKeywords } from './jobs/keywords';
import { purgeExpired, purgeImports } from './jobs/purge';
import { sendTestNotification } from './jobs/push-test';
import { type PushMessage, pushToUser } from './notify';
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

  const vapid =
    secrets.vapidPublicKey && secrets.vapidPrivateKey
      ? {
          subject: config.settings.push.vapidSubject,
          publicKey: secrets.vapidPublicKey,
          privateKey: secrets.vapidPrivateKey,
        }
      : null;

  // Claude API (ADR 0009): without a key, every AI step answers "not configured".
  const ai = createAiService({
    db: database.db,
    settings: config.settings,
    logger,
    apiKey: secrets.anthropicApiKey,
  });
  logger.info({ enabled: ai.enabled }, 'claude api');

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
  // The Belgian localities (ADR 0017), loaded by the migration: read once.
  const gazetteer = new Gazetteer(await readLocalities(database.db), config.settings.geo);
  // Postings stored before their identity (ADR 0016) or their place (ADR 0017) existed get
  // them, before any pass may add to their announcements.
  await prepareStoredPostings(
    { db: database.db, logger, gazetteer, settings: config.settings },
    connectors.map((connector) => connector.name),
  );
  // Push to the phone (decision D4: silent sources; D7: new offers of 80 or more).
  const notify = vapid
    ? (userId: string, message: PushMessage) =>
        pushToUser({ db: database.db, logger, vapid }, userId, message)
    : undefined;
  const scoringDeps = { db: database.db, ai, settings: config.settings, logger };
  const topOffers = (userId: string) =>
    alertTopOffers({ ...scoringDeps, ...(notify ? { notify } : {}) }, userId);
  // The scoring by Claude after each pass (phase 3 plan, sections 7 bis and 8), when the setting
  // switches it on (decision D5: off); one run per account at a time, never run twice. The new
  // offers of 80 or more are told once it is done (decision D7).
  const claudeScoring = config.settings.ai.scoring.enabled;
  await ensureQueue(boss, QUEUES.offersAiScore, {
    expireInSeconds: Math.ceil(config.settings.ai.scoring.staleAfterMs / 1000),
    retryLimit: 0,
  });
  await boss.work<OffersAiScoreJob>(QUEUES.offersAiScore, async (jobs) => {
    for (const job of jobs) {
      await scoreWithClaude(scoringDeps, job.data.userId);
      await topOffers(job.data.userId);
    }
  });
  // The measure of the reference set (phase 3 plan, section 9), asked for from the home machine.
  await ensureQueue(boss, QUEUES.scoringBenchmark, {
    expireInSeconds: Math.ceil(config.settings.scoring.reference.timeoutMs / 1000),
    retryLimit: 0,
  });
  await boss.work<ScoringBenchmarkJob>(QUEUES.scoringBenchmark, async (jobs) => {
    for (const job of jobs) await runBenchmark(scoringDeps, job.data);
  });
  const collectDeps = {
    db: database.db,
    gazetteer,
    settings: config.settings,
    logger,
    connectors,
    // Adzuna and SerpApi (decision D2): empty until Mehdi writes them on the home machine.
    secrets: secrets.sourceKeys,
    // Silent sources reach the phone (decision D4) when the push keys exist.
    ...(notify ? { notify } : {}),
    // After a pass: the scoring by Claude when it is on, else at once the new offers of 80.
    afterPass: (userId: string) =>
      claudeScoring
        ? boss.send(QUEUES.offersAiScore, { userId }, { singletonKey: userId })
        : topOffers(userId),
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
  // The deterministic filter, then the scoring, again on every offer of an account whose
  // profile changed (phase 3 plan, sections 6 and 7).
  await ensureQueue(boss, QUEUES.offersScreen);
  await boss.work<OffersScreenJob>(QUEUES.offersScreen, async (jobs) => {
    for (const job of jobs) {
      const { userId } = job.data;
      const now = new Date();
      const result = await withUser(database.db, userId, async (tx) => {
        const criteria = await screenProfileOf(tx, userId, config.settings, now);
        const screened = await screenOffers(tx, userId, null, criteria, now);
        const scoring = await scoringContextOf(tx, userId, config.settings, now);
        return { ...screened, ...(await scoreOffers(tx, userId, null, scoring, now)) };
      });
      logger.info(result, 'offers screened and scored');
    }
  });
  logger.info({ sources: connectors.map((connector) => connector.name) }, 'collection ready');

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
