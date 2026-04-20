import { useRouter } from 'next/router';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { appMessage } from '@/utils/antdAppBridge';
import { getUserConfig, UserConfig } from '@/utils/env';
import { trackUserTelemetry } from '@/utils/telemetry';

type ContextProps = {
  config?: UserConfig | null;
};

const GlobalConfigContext = createContext<ContextProps>({});
let cachedUserConfigPromise: Promise<UserConfig> | null = null;

const loadUserConfigOnce = () => {
  if (!cachedUserConfigPromise) {
    cachedUserConfigPromise = getUserConfig().catch((error) => {
      cachedUserConfigPromise = null;
      throw error;
    });
  }

  return cachedUserConfigPromise;
};

export const GlobalConfigProvider = ({ children }: { children: ReactNode }) => {
  const router = useRouter();
  const [config, setConfig] = useState<UserConfig | null>(null);

  useEffect(() => {
    let disposed = false;

    loadUserConfigOnce()
      .then((config) => {
        if (disposed) {
          return;
        }

        setConfig(config);
      })
      .catch(() => {
        appMessage.error('加载全局配置失败，请刷新页面重试');
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }

    const cleanupTelemetry = trackUserTelemetry(router.events, config);
    return () => {
      cleanupTelemetry();
    };
  }, [config, router.events]);

  const value = {
    config,
  };

  return (
    <GlobalConfigContext.Provider value={value}>
      {children}
    </GlobalConfigContext.Provider>
  );
};

export default function useGlobalConfig() {
  return useContext(GlobalConfigContext);
}
