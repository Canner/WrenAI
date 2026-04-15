import { useMemo } from 'react';
import { AppProps } from 'next/app';
import Head from 'next/head';
import { Spin } from 'antd';
import posthog from 'posthog-js';
import {
  buildRuntimeScopeStateKey,
  readRuntimeScopeSelectorFromUrl,
} from '@/apollo/client/runtimeScope';
import PersistentConsoleShell, {
  shouldKeyRuntimeScopePage,
} from '@/components/reference/PersistentConsoleShell';
import RuntimeScopeBootstrap from '@/components/runtimeScope/RuntimeScopeBootstrap';
import { GlobalConfigProvider } from '@/hooks/useGlobalConfig';
import { RuntimeSelectorStateProvider } from '@/hooks/useRuntimeSelectorState';
import { PostHogProvider } from 'posthog-js/react';
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
  const componentKey = useMemo(
    () =>
      shouldKeyRuntimeScopePage(router.pathname)
        ? runtimeScopePageKey
        : undefined,
    [router.pathname, runtimeScopePageKey],
  );

  return (
    <>
      <Head>
        <title>Nova</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <GlobalConfigProvider>
        <PostHogProvider client={posthog}>
          <RuntimeScopeBootstrap>
            <RuntimeSelectorStateProvider>
              <main className="app">
                <PersistentConsoleShell>
                  <Component key={componentKey} {...pageProps} />
                </PersistentConsoleShell>
              </main>
            </RuntimeSelectorStateProvider>
          </RuntimeScopeBootstrap>
        </PostHogProvider>
      </GlobalConfigProvider>
    </>
  );
}

export default App;
