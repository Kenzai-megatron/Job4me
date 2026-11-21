import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const ORIGIN = `http://localhost:${PORT}`;
export const STATE_FILE = join(import.meta.dirname, '.state', 'e2e.json');

// The real API serves the built interface (same origin, real CSP) on a fresh database.
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
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
  webServer: {
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
    },
  },
});
