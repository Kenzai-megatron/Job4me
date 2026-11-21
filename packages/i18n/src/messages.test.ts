import { errorCodes } from '@job4me/contracts';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatEuros, formatNumber, resources } from './index';

type Tree = { [key: string]: string | Tree };

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
  );
}

const french = keys(resources.fr.translation);

describe('translation files', () => {
  it('translate every error code the API can return', () => {
    for (const code of errorCodes) expect(french).toContain(`errors.${code}`);
  });

  it('only hold keys that exist in French (nl and en fall back to French)', () => {
    for (const language of ['nl', 'en'] as const) {
      for (const key of keys(resources[language].translation)) {
        expect(french).toContain(key);
      }
    }
  });
});

describe('Belgian formats', () => {
  const date = new Date('2026-11-19T13:05:00Z');

  it('formats dates in Brussels time', () => {
    expect(formatDate(date)).toBe('19/11/2026');
    expect(formatDateTime(date)).toMatch(/^19\/11\/2026.*14:05$/);
  });

  it('formats numbers and euros the Belgian way', () => {
    expect(formatNumber(1234.56).replace(/\s/g, ' ')).toBe('1 234,56');
    expect(formatEuros(9.99).replace(/\s/g, ' ')).toBe('9,99 €');
  });
});
