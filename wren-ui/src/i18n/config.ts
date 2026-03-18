export const LOCALES = ['en', 'fr'] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'en';

export const LOCALE_COOKIE = 'NEXT_LOCALE';
