import { NextRouter } from 'next/router';

export const pushWithLocale = async (router: NextRouter, href: string) => {
  return router.push(href, href, { locale: router.locale });
};
