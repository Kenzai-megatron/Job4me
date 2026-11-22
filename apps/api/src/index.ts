import { loadConfig, loadSecrets } from '@job4me/config';
import { connect } from '@job4me/db';
import { createLogger } from '@job4me/logger';
import { buildApp } from './app';
import { deriveKeys } from './context';

async function main(): Promise<void> {
  const config = loadConfig();
  const secrets = loadSecrets();
  const logger = createLogger({ name: 'api' });
  const database = connect(secrets.databaseUrl, { applicationName: 'job4me-api' });

  const app = await buildApp({
    config,
    db: database.db,
    keys: deriveKeys(secrets.masterKey),
    logger,
    vapidPublicKey: secrets.vapidPublicKey,
    webDistDir: process.env.JOB4ME_WEB_DIST,
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await app.close();
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
