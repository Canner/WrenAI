import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // we init with resources
    resources: {
      en: {
        common: {
          'Question-SQL pairs': 'Question-SQL pairs',
          'Instructions': 'Instructions',
        },
      },
      fa: {
        common: {
          'Question-SQL pairs': 'جفت‌های پرسش و SQL',
          'Instructions': 'دستورالعمل‌ها',
        },
      },
    },
    fallbackLng: 'en',
    debug: true,

    // have a common namespace used around the full app
    ns: ['common'],
    defaultNS: 'common',

    keySeparator: false, // we use content as keys

    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
