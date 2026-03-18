import en from '../../messages/en.json';

declare module 'next-intl' {
  interface AppConfig {
    Locale: 'en' | 'fr';
    Messages: typeof en;
  }
}
