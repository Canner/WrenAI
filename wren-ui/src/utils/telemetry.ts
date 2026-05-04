import posthog from 'posthog-js';
import { NextRouter } from 'next/router';
import env, { UserConfig } from '@/utils/env';

const setupPostHog = (userConfig) => {
  // Check that PostHog is client-side (used to handle Next.js SSR)
  if (typeof window !== 'undefined') {
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

export const trackUserTelemetry = (router: NextRouter, config: UserConfig) => {
  const handlePostHogPageView = () => {
    posthog.capture('$pageview');
  };

  // Track PostHog
  if (config.isTelemetryEnabled) {
    setupPostHog(config);
    router.events.on('routeChangeComplete', handlePostHogPageView);
  }

  return () => {
    router.events.off('routeChangeComplete', handlePostHogPageView);
  };
};
