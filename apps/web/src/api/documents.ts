import type { DocumentVersionsResponse, MasterCv, MasterCvList } from '@job4me/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from './client';

/** The target jobs and their master CVs (phase 4 plan, section 4). */
export const masterCvsQuery = queryOptions({
  queryKey: ['documents', 'master-cvs'],
  queryFn: () => api.get<MasterCvList>('/api/master-cvs'),
});

export function masterCvQuery(id: string) {
  return queryOptions({
    queryKey: ['documents', 'master-cv', id],
    queryFn: () => api.get<MasterCv>(`/api/master-cvs/${id}`),
  });
}

export function documentVersionsQuery(documentId: string) {
  return queryOptions({
    queryKey: ['documents', 'versions', documentId],
    queryFn: () => api.get<DocumentVersionsResponse>(`/api/documents/${documentId}/versions`),
  });
}
