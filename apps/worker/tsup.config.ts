import { defineConfig } from 'tsup';

// Same bundling as the API: workspace sources inlined, third-party dependencies external.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: false,
  skipNodeModulesBundle: true,
  noExternal: [/^@job4me\//],
});
