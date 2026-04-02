import { useMemo } from 'react';
import { AppProps } from 'next/app';
import Head from 'next/head';
import { Spin } from 'antd';
import posthog from 'posthog-js';
import apolloClient from '@/apollo/client';
import {
  buildRuntimeScopeStateKey,
  readRuntimeScopeSelectorFromUrl,
} from '@/apollo/client/runtimeScope';
import RuntimeScopeBootstrap from '@/components/runtimeScope/RuntimeScopeBootstrap';
import { GlobalConfigProvider } from '@/hooks/useGlobalConfig';
import { PostHogProvider } from 'posthog-js/react';
import { ApolloProvider } from '@apollo/client';
import { defaultIndicator } from '@/components/PageLoading';

require('../styles/index.less');

Spin.setDefaultIndicator(defaultIndicator);

function App({ Component, pageProps, router }: AppProps) {
  const runtimeScopePageKey = useMemo(
    () =>
      `${router.pathname}:${buildRuntimeScopeStateKey(
        readRuntimeScopeSelectorFromUrl(router.asPath),
      )}`,
    [router.asPath, router.pathname],
  );

  return (
    <>
      <Head>
        <title>Wren AI</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <GlobalConfigProvider>
        <ApolloProvider client={apolloClient}>
          <PostHogProvider client={posthog}>
            <RuntimeScopeBootstrap>
              <main className="app">
                <Component key={runtimeScopePageKey} {...pageProps} />
              </main>
            </RuntimeScopeBootstrap>
          </PostHogProvider>
        </ApolloProvider>
      </GlobalConfigProvider>
    </>
  );
}

export default App;
