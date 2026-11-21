import { configDefaults, defineConfig } from 'vitest/config';

/** Unit tests: fast, no database. */
export const unitConfig = defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.int.test.ts'],
  },
});

/** Integration tests: real PostgreSQL, run one file at a time. */
export const integrationConfig = defineConfig({
  test: {
    include: ['**/*.int.test.ts'],
    exclude: [...configDefaults.exclude],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
