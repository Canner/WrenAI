import { AppProps } from 'next/app';
import Head from 'next/head';
import { Spin } from 'antd';
import env from '@/utils/env';
import posthog from 'posthog-js';
import apolloClient from '@/apollo/client';
import { PostHogProvider } from 'posthog-js/react';
import { ApolloProvider } from '@apollo/client';
import { defaultIndicator } from '@/components/PageLoading';

require('../styles/index.less');

Spin.setDefaultIndicator(defaultIndicator);

// Check that PostHog is client-side (used to handle Next.js SSR)
if (env.isTelemetryEnabled && typeof window !== 'undefined') {
  posthog.init(env.posthogAPIKey, {
    api_host: env.posthogHost,
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
    // Enable debug mode in development
    loaded: (posthog) => {
      if (env.isDevelopment) posthog.debug();
    },
  });
}

function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>WrenAI</title>
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
