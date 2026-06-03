import { AppProps } from 'next/app';
import Head from 'next/head';
import { Spin } from 'antd';
import posthog from 'posthog-js';
import apolloClient from '@/apollo/client';
import { GlobalConfigProvider } from '@/hooks/useGlobalConfig';
import { PostHogProvider } from 'posthog-js/react';
import { ApolloProvider } from '@apollo/client';
import { defaultIndicator } from '@/components/PageLoading';
import { AuthGate, AuthProvider } from '@/hooks/useAuth';

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
          <AuthProvider>
            <PostHogProvider client={posthog}>
              <AuthGate>
                <main className="app">
                  <Component {...pageProps} />
                </main>
              </AuthGate>
            </PostHogProvider>
          </AuthProvider>
        </ApolloProvider>
      </GlobalConfigProvider>
    </>
  );
}

export default App;
