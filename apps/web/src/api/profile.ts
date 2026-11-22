import type { Completeness, Identity, ProfileDocument, ProfileRubric } from '@job4me/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from './client';

export type ProfileResponse = ProfileDocument & { defaultRadiusKm: number };
export type RubricItem = Record<string, unknown> & { id: string };

export const profileQuery = queryOptions({
  queryKey: ['profile', 'document'],
  queryFn: () => api.get<ProfileResponse>('/api/profile'),
});

export const identityQuery = queryOptions({
  queryKey: ['profile', 'identity'],
  queryFn: () => api.get<Identity>('/api/profile/identity'),
});

export const completenessQuery = queryOptions({
  queryKey: ['profile', 'completeness'],
  queryFn: () => api.get<Completeness>('/api/profile/completeness'),
});

export function rubricQuery(slug: ProfileRubric) {
  return queryOptions({
    queryKey: ['profile', 'rubric', slug],
    queryFn: () => api.get<{ items: RubricItem[] }>(`/api/profile/${slug}`),
  });
}
