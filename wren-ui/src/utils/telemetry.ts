import posthog from 'posthog-js';
import { NextRouter } from 'next/router';
import env, { UserConfig } from '@/utils/env';

let telemetryInitialized = false;

const setupPostHog = (userConfig: UserConfig) => {
  if (telemetryInitialized) {
    return;
  }

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
    });
    // set up distinct id to posthog
    if (userConfig.userUUID) posthog.identify(userConfig.userUUID);
    telemetryInitialized = true;
  }
};

export const resetTelemetryStateForTests = () => {
  telemetryInitialized = false;
};

export const captureUserTelemetryEvent = (
  event: string,
  properties?: Record<string, any>,
) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    posthog.capture(event, properties);
  } catch {
    // no-op: telemetry should never block the user flow
  }
};

export const trackUserTelemetry = (
  routerEvents: NextRouter['events'],
  config: UserConfig,
) => {
  const handlePostHogPageView = () => {
    posthog.capture('$pageview');
  };

  // Track PostHog
  if (config.isTelemetryEnabled) {
    setupPostHog(config);
    routerEvents.on('routeChangeComplete', handlePostHogPageView);
  }

  return () => {
    routerEvents.off('routeChangeComplete', handlePostHogPageView);
  };
};
