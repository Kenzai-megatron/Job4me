import { defineConfig } from 'tsup';

// Same bundling as the API: workspace sources inlined, third-party dependencies external.
// The extractor (ADR 0010) runs from its own entry in its own container; each file is read in a
// thread started from extract-thread.js.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    extractor: 'src/extractor/index.ts',
    'extract-thread': 'src/extractor/thread.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: false,
  skipNodeModulesBundle: true,
  noExternal: [/^@job4me\//],
});
