import { defineConfig } from 'vitest/config';

// `pnpm test:scripts`: the pure parts of the repository scripts (backup retention).
export default defineConfig({
  test: { include: ['scripts/**/*.test.ts'], passWithNoTests: false },
});
