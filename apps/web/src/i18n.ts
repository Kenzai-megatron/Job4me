import { defaultLanguage, resources } from '@job4me/i18n';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

export function initI18n() {
  void i18next.use(initReactI18next).init({
    resources,
    lng: defaultLanguage,
    fallbackLng: defaultLanguage,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  document.documentElement.lang = defaultLanguage;
}
