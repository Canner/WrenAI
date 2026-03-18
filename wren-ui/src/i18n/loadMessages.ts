import { AbstractIntlMessages } from 'next-intl';
import { AppLocale, DEFAULT_LOCALE, LOCALES } from './config';

const getLocale = (locale?: string): AppLocale => {
  if (!locale) {
    return DEFAULT_LOCALE;
  }

  return LOCALES.includes(locale as AppLocale)
    ? (locale as AppLocale)
    : DEFAULT_LOCALE;
};

export const loadMessages = async (
  locale?: string,
): Promise<AbstractIntlMessages> => {
  const normalizedLocale = getLocale(locale);
  return (await import(`../../messages/${normalizedLocale}.json`)).default;
};

export const getNormalizedLocale = (locale?: string): AppLocale => {
  return getLocale(locale);
};
