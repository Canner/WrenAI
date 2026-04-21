import { useMemo } from 'react';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { App as AntdApp, ConfigProvider, Spin } from 'antd';
import 'antd/dist/reset.css';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import {
  buildRuntimeScopeStateKey,
  readRuntimeScopeSelectorFromUrl,
} from '@/runtime/client/runtimeScope';
import PersistentConsoleShell, {
  shouldKeyRuntimeScopePage,
} from '@/components/reference/PersistentConsoleShell';
import RuntimeScopeBootstrap from '@/components/runtimeScope/RuntimeScopeBootstrap';
import AntdAppBridge from '@/components/app/AntdAppBridge';
import { GlobalConfigProvider } from '@/hooks/useGlobalConfig';
import { RuntimeSelectorStateProvider } from '@/hooks/useRuntimeSelectorState';
import { defaultIndicator } from '@/components/PageLoading';
import {
  NOVA_APP_NAME,
  NOVA_DEFAULT_DESCRIPTION,
  NOVA_SOCIAL_IMAGE_PATH,
  resolveNovaPageTitle,
} from '@/utils/brandMeta';
import { antdTheme } from '@/styles/antdTheme';
import '../styles/index.less';
import '../styles/runtime-foundation.css';
import '../styles/runtime-utilities.css';

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
  const pageTitle = useMemo(
    () =>
      resolveNovaPageTitle({
        pathname: router.pathname,
        query: router.query,
      }),
    [router.pathname, router.query],
  );

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="alternate icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="application-name" content={NOVA_APP_NAME} />
        <meta name="apple-mobile-web-app-title" content={NOVA_APP_NAME} />
        <meta name="theme-color" content="#6D4AFF" />
        <meta name="description" content={NOVA_DEFAULT_DESCRIPTION} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={NOVA_APP_NAME} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={NOVA_DEFAULT_DESCRIPTION} />
        <meta property="og:image" content={NOVA_SOCIAL_IMAGE_PATH} />
        <meta property="og:image:alt" content="Nova 品牌分享图" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={NOVA_DEFAULT_DESCRIPTION} />
        <meta name="twitter:image" content={NOVA_SOCIAL_IMAGE_PATH} />
      </Head>
      <ConfigProvider theme={antdTheme}>
        <AntdApp>
          <AntdAppBridge>
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
          </AntdAppBridge>
        </AntdApp>
      </ConfigProvider>
    </>
  );
}

export default App;
