import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';

/** Translates an error into a sentence for the person, never a raw technical message. */
export function errorMessage(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'locked') {
      const minutes = Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60));
      return t('errors.locked', { minutes });
    }
    return t(`errors.${error.code}`, { defaultValue: t('errors.internal_error') });
  }
  return t('errors.internal_error');
}
