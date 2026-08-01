import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ThemeMode } from '@/app/theme/tokens';

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

interface UiState {
  themeMode: ThemeMode;
  /** Whether the left contextual sidebar is collapsed. */
  sidebarCollapsed: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  toggleThemeMode: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
}

/**
 * App-shell UI state. Per the module-per-store convention, feature modules
 * (ask / context / harness / eval / …) own their own stores; this one holds
 * only cross-cutting shell state (theme, sidebar).
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      themeMode: systemPrefersDark() ? 'dark' : 'light',
      sidebarCollapsed: false,
      setThemeMode: (themeMode) => set({ themeMode }),
      toggleThemeMode: () =>
        set((s) => ({ themeMode: s.themeMode === 'dark' ? 'light' : 'dark' })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: 'wren-genbi-ui' },
  ),
);
