import en from './messages/en.json' with { type: 'json' };
import fr from './messages/fr.json' with { type: 'json' };
import nl from './messages/nl.json' with { type: 'json' };

// French by default; Dutch and English files are ready and fall back to French (SPEC section 9).
export const defaultLanguage = 'fr';
export const supportedLanguages = ['fr', 'nl', 'en'] as const;
export type Language = (typeof supportedLanguages)[number];

export const resources = {
  fr: { translation: fr },
  nl: { translation: nl },
  en: { translation: en },
} as const;

export type Messages = typeof fr;

const LOCALES: Record<Language, string> = { fr: 'fr-BE', nl: 'nl-BE', en: 'en-BE' };
export const TIME_ZONE = 'Europe/Brussels';

export function localeFor(language: string): string {
  return LOCALES[language as Language] ?? LOCALES.fr;
}

/** 19/11/2026 */
export function formatDate(value: Date | string, language = defaultLanguage): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

/** 19/11/2026 14:05 */
export function formatDateTime(value: Date | string, language = defaultLanguage): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/** 1 234,56 */
export function formatNumber(value: number, language = defaultLanguage): string {
  return new Intl.NumberFormat(localeFor(language)).format(value);
}

/** 9,99 € */
export function formatEuros(value: number, language = defaultLanguage): string {
  return new Intl.NumberFormat(localeFor(language), { style: 'currency', currency: 'EUR' }).format(
    value,
  );
}
