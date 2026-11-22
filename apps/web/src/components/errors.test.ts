import { resources } from '@job4me/i18n';
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { errorMessage } from './errors';

beforeAll(async () => {
  await i18next.init({ resources, lng: 'fr', interpolation: { escapeValue: false } });
});

describe('errorMessage', () => {
  it('translates API error codes', () => {
    expect(errorMessage(i18next.t, new ApiError(401, 'invalid_code'))).toBe(
      "Ce code n'est pas valide ou a déjà servi.",
    );
  });

  it('tells how long a lock lasts, in minutes', () => {
    expect(errorMessage(i18next.t, new ApiError(429, 'locked', 150))).toContain('3 min');
  });

  it('never shows a raw technical message', () => {
    expect(errorMessage(i18next.t, new Error('ECONNRESET at socket.js:12'))).toBe(
      'Une erreur est survenue. Réessayez dans un instant.',
    );
  });
});
