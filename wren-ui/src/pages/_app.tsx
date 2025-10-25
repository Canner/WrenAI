import { AppProps } from 'next/app';
import Head from 'next/head';
import { Spin } from 'antd';
import posthog from 'posthog-js';
import apolloClient from '@/apollo/client';
import { GlobalConfigProvider } from '@/hooks/useGlobalConfig';
import { PostHogProvider } from 'posthog-js/react';
import { ApolloProvider } from '@apollo/client';
import { defaultIndicator } from '@/components/PageLoading';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';

require('../styles/index.less');

Spin.setDefaultIndicator(defaultIndicator);

function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Wren AI</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <GlobalConfigProvider>
        <ApolloProvider client={apolloClient}>
          <PostHogProvider client={posthog}>
            <I18nextProvider i18n={i18n}>
              <main className="app">
                <Component {...pageProps} />
              </main>
            </I18nextProvider>
          </PostHogProvider>
        </ApolloProvider>
      </GlobalConfigProvider>
    </>
  );
}

export default App;
