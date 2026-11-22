import { defineConfig } from 'tsup';

// Production bundle: our workspace packages (TypeScript sources) are inlined,
// third-party dependencies stay external and come from node_modules.
export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli/index.ts', migrate: 'src/migrate.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: false,
  skipNodeModulesBundle: true,
  noExternal: [/^@job4me\//],
});
