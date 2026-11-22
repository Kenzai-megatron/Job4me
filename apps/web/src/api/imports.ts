import type { ImportRun } from '@job4me/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from './client';

/** Steps during which the list refreshes itself (the extractor and the worker work behind). */
const PENDING = new Set<ImportRun['status']>(['queued', 'extracting', 'structuring']);

/** A CV whose text is read still waits for its structuring; a LinkedIn archive does not (lot 5). */
function pending(run: ImportRun): boolean {
  return PENDING.has(run.status) || (run.status === 'extracted' && run.kind !== 'linkedin_zip');
}

export const importsQuery = queryOptions({
  queryKey: ['imports'],
  queryFn: () => api.get<{ items: ImportRun[] }>('/api/imports'),
  refetchInterval: (query) => (query.state.data?.items.some(pending) ? 2000 : false),
});
