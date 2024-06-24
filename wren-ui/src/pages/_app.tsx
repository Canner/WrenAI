import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppProps } from 'next/app';
import Head from 'next/head';
import { Spin } from 'antd';
import env, { getUserConfig } from '@/utils/env';
import posthog from 'posthog-js';
import apolloClient from '@/apollo/client';
import { PostHogProvider } from 'posthog-js/react';
import { ApolloProvider } from '@apollo/client';
import { defaultIndicator } from '@/components/PageLoading';

require('../styles/index.less');

Spin.setDefaultIndicator(defaultIndicator);

const setupTelemetry = (userConfig) => {
  // Check that PostHog is client-side (used to handle Next.js SSR)
  if (userConfig.isTelemetryEnabled && typeof window !== 'undefined') {
    posthog.init(userConfig.telemetryKey, {
      api_host: userConfig.telemetryHost,
      autocapture: {
        dom_event_allowlist: ['click'],
        css_selector_allowlist: ['[data-ph-capture="true"]'],
      },
      session_recording: {
        maskAllInputs: false,
        maskInputOptions: {
          password: true,
        },
      },
      disable_session_recording: env.isDevelopment,
      debug: false,
      loaded: () => {
        console.log('PostHog initialized.');
      },
    });
    // set up distinct id to posthog
    if (userConfig.userUUID) posthog.identify(userConfig.userUUID);
  }
};

function App({ Component, pageProps }: AppProps) {
  const router = useRouter();

  useEffect(() => {
    const handleRouteChange = () => posthog.capture('$pageview');

    getUserConfig().then((config) => {
      setupTelemetry(config);
      // Track page views
      router.events.on('routeChangeComplete', handleRouteChange);
    });

    return () => {
      router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, []);

  return (
    <>
      <Head>
        <title>Wren AI</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <ApolloProvider client={apolloClient}>
        <PostHogProvider client={posthog}>
          <main className="app">
            <Component {...pageProps} />
          </main>
        </PostHogProvider>
      </ApolloProvider>
    </>
  );
}

export default App;
