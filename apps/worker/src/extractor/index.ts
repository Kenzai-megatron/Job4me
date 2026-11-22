import { loadConfig, loadExtractorSecrets } from '@job4me/config';
import { connect } from '@job4me/db';
import { createLogger } from '@job4me/logger';
import { parseKey } from '@job4me/security';
import { startExtractor } from './extractor';
import { threadRunner } from './runner';

// Isolated extractor (ADR 0010), bundled as extractor.js and run by the `extract` container:
// internal network only, the job4me_extractor role, the import key and nothing else.

async function main(): Promise<void> {
  const config = loadConfig();
  const secrets = loadExtractorSecrets();
  const logger = createLogger({ name: 'extractor' });
  const { imports, files } = config.settings;
  const database = connect(secrets.databaseUrl, { applicationName: 'job4me-extractor', max: 2 });
  const extractor = startExtractor(
    {
      db: database.db,
      key: parseKey(secrets.importKey, 'import key'),
      filesDir: files.dir,
      logger,
      runner: threadRunner({
        limits: imports,
        timeoutMs: imports.extractor.timeoutMs,
        memoryMb: imports.extractor.memoryMb,
      }),
      maxAttempts: imports.extractor.maxAttempts,
      staleAfterMs: imports.extractor.staleAfterMs,
    },
    imports.extractor.pollIntervalMs,
  );
  logger.info('extractor started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await extractor.stop();
    await database.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  process.stderr.write(
    `extractor failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
