const env = {
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
};

export default env;

export type UserConfig = {
  isTelemetryEnabled: boolean;
  telemetryKey: string;
  telemetryHost: string;
  userUUID: string;
};

const DEFAULT_USER_CONFIG: UserConfig = {
  isTelemetryEnabled: false,
  telemetryKey: '',
  telemetryHost: '',
  userUUID: '',
};

let userConfigCache: UserConfig | null = null;
let userConfigRequest: Promise<UserConfig> | null = null;

export const clearUserConfigCache = () => {
  userConfigCache = null;
  userConfigRequest = null;
};

// Get the user configuration
export const getUserConfig = async (): Promise<UserConfig> => {
  if (userConfigCache) {
    return userConfigCache;
  }

  if (userConfigRequest) {
    return userConfigRequest;
  }

  userConfigRequest = fetch('/api/config')
    .then(async (response) => {
      if (!response.ok) {
        return DEFAULT_USER_CONFIG;
      }

      const config = await response.json();
      const decodedTelemetryKey = config?.telemetryKey
        ? Buffer.from(config.telemetryKey, 'base64').toString()
        : '';

      return {
        ...DEFAULT_USER_CONFIG,
        ...config,
        telemetryKey: decodedTelemetryKey,
      };
    })
    .catch(() => DEFAULT_USER_CONFIG)
    .then((config) => {
      userConfigCache = config;
      return config;
    })
    .finally(() => {
      userConfigRequest = null;
    });

  return userConfigRequest;
};
