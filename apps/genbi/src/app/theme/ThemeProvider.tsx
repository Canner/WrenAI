import { useEffect, type ReactNode } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';
import { useUiStore } from '@/stores/useUiStore';
import { surface2, themeConfig } from './tokens';

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Applies the Wren AI Design System theme via AntD's ConfigProvider and mounts
 * AntD's `App` context (so message/notification/modal work without a static
 * instance). Theme mode comes from the UI store; it also reflects onto the
 * document root as `data-theme` for any non-AntD CSS, plus the app-level
 * `--genbi-surface-2` var (the one mockup token — `--surface-2` — with no
 * clean 1:1 AntD alias) for custom markup like the Context ER diagram.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const themeMode = useUiStore((s) => s.themeMode);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    document.documentElement.style.setProperty('--genbi-surface-2', surface2[themeMode]);
  }, [themeMode]);

  return (
    <ConfigProvider theme={themeConfig(themeMode)}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
