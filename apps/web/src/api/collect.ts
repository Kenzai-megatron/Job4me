import type {
  CollectionPass,
  Offer,
  OffersResponse,
  OfferView,
  SourcesResponse,
} from '@job4me/contracts';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from './client';

export const sourcesQuery = queryOptions({
  queryKey: ['sources'],
  queryFn: () => api.get<SourcesResponse>('/api/sources'),
});

/** The latest "test the sources", read again while the worker is on it. */
export const latestTestQuery = queryOptions({
  queryKey: ['sources', 'test'],
  queryFn: () => api.get<{ pass: CollectionPass | null }>('/api/sources/test'),
  refetchInterval: (query) => {
    const status = query.state.data?.pass?.status;
    return status === 'queued' || status === 'running' ? 2000 : false;
  },
});

/** One announcement with all its postings (ADR 0016). */
export function offerQuery(id: string) {
  return queryOptions({
    queryKey: ['offer', id],
    queryFn: () => api.get<Offer>(`/api/offers/${id}`),
  });
}

/**
 * Announcements by score, then the freshest, page by page: the ones the filter keeps, or the ones
 * it sets aside; `source`, `band` and `fresh` narrow them.
 */
export function offersQuery(
  source: string,
  view: OfferView = 'kept',
  filters: { band?: string; fresh?: boolean } = {},
) {
  return infiniteQueryOptions({
    queryKey: ['offers', source, view, filters.band ?? '', Boolean(filters.fresh)],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (view !== 'kept') params.set('view', view);
      if (source) params.set('source', source);
      if (filters.band) params.set('band', filters.band);
      if (filters.fresh) params.set('fresh', 'true');
      if (pageParam) params.set('before', pageParam);
      const query = params.toString();
      return api.get<OffersResponse>(`/api/offers${query ? `?${query}` : ''}`);
    },
    getNextPageParam: (page) => page.nextCursor,
  });
}

/** Only http and https links are ever rendered as links (plan, section 9, threat 6). */
export function safeLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}
