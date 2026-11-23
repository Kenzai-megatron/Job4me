import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
// E2E_BASE_URL: a stack that already runs, `pnpm test:e2e:stack` (containers, production mode).
const EXTERNAL = process.env.E2E_BASE_URL;
const ORIGIN = EXTERNAL ?? `http://localhost:${PORT}`;
export const STATE_FILE = join(import.meta.dirname, '.state', 'e2e.json');

// The real API serves the built interface (same origin, real CSP) on a fresh database.
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  // No retry: the specs share one single-use enrollment link, so a retry could never pass.
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: ORIGIN,
    trace: 'off',
    locale: 'fr-BE',
    timezoneId: 'Europe/Brussels',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: EXTERNAL
    ? undefined
    : {
        command: 'pnpm --filter @job4me/api exec tsx src/testing/e2e-server.ts',
        url: `${ORIGIN}/api/ready`,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'pipe',
        env: {
          JOB4ME_ENV: 'test',
          JOB4ME_PUBLIC_ORIGIN: ORIGIN,
          JOB4ME_RP_ID: 'localhost',
          JOB4ME_LISTEN_PORT: String(PORT),
          JOB4ME_WEB_DIST: join(import.meta.dirname, '..', '..', 'apps', 'web', 'dist'),
          E2E_STATE_FILE: STATE_FILE,
          // The demo source (no request at all) stands in for the real ones.
          JOB4ME_COLLECT_DEMO_SOURCE: 'true',
        },
      },
});
