import type { AuditEntry, SecurityOverview, SessionState, SessionSummary } from '@job4me/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api, setCsrfToken } from './client';

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async () => {
    const state = await api.get<SessionState>('/api/auth/session');
    setCsrfToken(state.csrfToken);
    return state;
  },
  staleTime: 60_000,
});

export const securityQuery = queryOptions({
  queryKey: ['security'],
  queryFn: () => api.get<SecurityOverview>('/api/auth/security'),
});

export const sessionsQuery = queryOptions({
  queryKey: ['sessions'],
  queryFn: () => api.get<{ sessions: SessionSummary[] }>('/api/auth/sessions'),
});

export const auditQuery = queryOptions({
  queryKey: ['audit'],
  queryFn: () => api.get<{ entries: AuditEntry[] }>('/api/audit?limit=50'),
});
