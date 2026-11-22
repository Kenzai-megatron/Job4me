import type { ImportRun } from '@job4me/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from './client';

/** Steps during which the list refreshes itself (the extractor works in the background). */
const PENDING = new Set<ImportRun['status']>(['queued', 'extracting', 'structuring']);

export const importsQuery = queryOptions({
  queryKey: ['imports'],
  queryFn: () => api.get<{ items: ImportRun[] }>('/api/imports'),
  refetchInterval: (query) =>
    query.state.data?.items.some((run) => PENDING.has(run.status)) ? 2000 : false,
});
