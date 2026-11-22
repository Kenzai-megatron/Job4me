import { ConfigError, loadConfig, loadSecrets } from '@job4me/config';
import { connect, queueOptions } from '@job4me/db';
import { PgBoss } from 'pg-boss';
import { createLogger } from '@job4me/logger';
import { parseKey } from '@job4me/security';
import { buildApp } from './app';
import { deriveKeys } from './context';

async function main(): Promise<void> {
  const config = loadConfig();
  const secrets = loadSecrets();
  if (!secrets.importKey) {
    throw new ConfigError(
      'missing secret JOB4ME_IMPORT_KEY (or JOB4ME_IMPORT_KEY_FILE); run pnpm setup:dev',
    );
  }
  const importKey = parseKey(secrets.importKey, 'import key');
  const logger = createLogger({ name: 'api' });
  const database = connect(secrets.databaseUrl, { applicationName: 'job4me-api' });
  // The API only adds jobs; the worker runs them and does the queue maintenance.
  const boss = new PgBoss({
    ...queueOptions(secrets.databaseUrl),
    supervise: false,
    schedule: false,
    max: 2,
  });
  boss.on('error', (error) => logger.error({ err: error }, 'queue error'));
  await boss.start();

  const app = await buildApp({
    config,
    db: database.db,
    keys: deriveKeys(secrets.masterKey),
    imports: { key: importKey, filesDir: config.settings.files.dir },
    logger,
    queue: boss,
    vapidPublicKey: secrets.vapidPublicKey,
    webDistDir: process.env.JOB4ME_WEB_DIST,
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    await boss.stop({ graceful: true });
    await database.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.settings.app.listenHost, port: config.settings.app.listenPort });
}

main().catch((error: unknown) => {
  // The logger may not exist yet: report on stderr without internal details beyond the message.
  process.stderr.write(
    `api failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
