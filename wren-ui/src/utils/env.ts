const env = {
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
};

export default env;

// Get the user configuration
export const getUserConfig = async () => {
  const config = await fetch('/api/config').then((res) => res.json());
  const decodedTelemetryKey = Buffer.from(
    config.telemetryKey,
    'base64',
  ).toString();
  return { ...config, telemetryKey: decodedTelemetryKey };
};
