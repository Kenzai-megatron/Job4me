import type { AiUsageResponse, BenchmarksResponse, KeywordRun } from '@job4me/contracts';
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

/** The reference set (phase 3 plan, section 9): ratings given and measures made. */
export const benchmarksQuery = queryOptions({
  queryKey: ['scoring', 'benchmarks'],
  queryFn: () => api.get<BenchmarksResponse>('/api/scoring/benchmarks'),
});
