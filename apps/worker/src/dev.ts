// `pnpm dev` only: the worker and the isolated extractor in one process, each with its own
// database role. In containers they are two services with different networks and secrets.
await import('./index');
await import('./extractor/index');
