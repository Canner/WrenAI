import NextApp, { AppContext, AppProps } from 'next/app';
import Head from 'next/head';
import { Spin } from 'antd';
import posthog from 'posthog-js';
import { AbstractIntlMessages, NextIntlClientProvider } from 'next-intl';
import apolloClient from '@/apollo/client';
import { GlobalConfigProvider } from '@/hooks/useGlobalConfig';
import { PostHogProvider } from 'posthog-js/react';
import { ApolloProvider } from '@apollo/client';
import { defaultIndicator } from '@/components/PageLoading';
import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';
import { loadMessages } from '@/i18n/loadMessages';

require('../styles/index.less');

Spin.setDefaultIndicator(defaultIndicator);

type CustomPageProps = AppProps['pageProps'] & {
  messages?: AbstractIntlMessages;
};

type CustomAppProps = AppProps<CustomPageProps>;

const stripLocalePrefix = (path: string) => {
  const localePrefixPattern = new RegExp(`^/(${LOCALES.join('|')})(?=/|$)`);
  const stripped = path.replace(localePrefixPattern, '');
  return stripped || '/';
};

function App({ Component, pageProps, router }: CustomAppProps) {
  const locale =
    router.locale && LOCALES.includes(router.locale as (typeof LOCALES)[number])
      ? router.locale
      : DEFAULT_LOCALE;
  const pathWithoutLocale = stripLocalePrefix(router.asPath || '/');

  const appTitle =
    (pageProps.messages?.app as { title?: string } | undefined)?.title ??
    'Kernel IQ';

  return (
    <NextIntlClientProvider locale={locale} messages={pageProps.messages}>
      <Head>
        <title>{appTitle}</title>
        <link rel="icon" href="/favicon.ico" />
        {LOCALES.map((supportedLocale) => {
          const href =
            supportedLocale === DEFAULT_LOCALE
              ? pathWithoutLocale
              : `/${supportedLocale}${pathWithoutLocale}`;

          return (
            <link
              key={supportedLocale}
              rel="alternate"
              hrefLang={supportedLocale}
              href={href}
            />
          );
        })}
        <link rel="alternate" hrefLang="x-default" href={pathWithoutLocale} />
      </Head>
      <GlobalConfigProvider>
        <ApolloProvider client={apolloClient}>
          <PostHogProvider client={posthog}>
            <main className="app">
              <Component {...pageProps} />
            </main>
          </PostHogProvider>
        </ApolloProvider>
      </GlobalConfigProvider>
    </NextIntlClientProvider>
  );
}

App.getInitialProps = async (appContext: AppContext) => {
  const appProps = await NextApp.getInitialProps(appContext);
  const locale = appContext.router.locale ?? DEFAULT_LOCALE;
  const messages = await loadMessages(locale);

  return {
    ...appProps,
    pageProps: {
      ...appProps.pageProps,
      messages,
    },
  };
};

export default App;
