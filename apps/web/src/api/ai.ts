import type { AiUsageResponse, KeywordRun } from '@job4me/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from './client';

export const aiUsageQuery = queryOptions({
  queryKey: ['ai', 'usage'],
  queryFn: () => api.get<AiUsageResponse>('/api/ai/usage'),
});

/** The latest keyword request, refreshed while the worker is on it. */
export const keywordRunQuery = queryOptions({
  queryKey: ['profile', 'keyword-run'],
  queryFn: () => api.get<{ run: KeywordRun | null }>('/api/profile/keywords/propose'),
  refetchInterval: (query) => {
    const status = query.state.data?.run?.status;
    return status === 'queued' || status === 'running' ? 2000 : false;
  },
});
