const env = {
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTelemetryEnabled:
    process.env.NEXT_PUBLIC_TELEMETRY_ENABLED &&
    process.env.NEXT_PUBLIC_TELEMETRY_ENABLED.toLocaleLowerCase() === 'true',
  userUUID: process.env.NEXT_PUBLIC_USER_UUID,
  posthogAPIKey: process.env.NEXT_PUBLIC_POSTHOG_API_KEY,
  posthogHost:
    process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
};

export default env;
