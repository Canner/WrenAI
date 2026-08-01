import { create } from 'zustand';
import { isBffEnabled } from '@/bff/env';
import { getHarness } from '@/bff/client';
import type { HarnessView } from './types';
import { t } from '@/i18n/strings';

/** Sidebar selection key for the one profile that is ever actually bound. */
export const BOUND_PROFILE_KEY = 'bound-profile';

interface HarnessStoreState {
  /** Key of the currently selected profile in the sidebar's profile selector. */
  selectedProfileKey: string;
  /** Live-fetched harness view, once loaded. Fixture mode never populates this. */
  harness?: HarnessView;
  /** True while the live harness fetch is in flight. Always false in fixture mode. */
  loading: boolean;
  /** Set when the live harness fetch failed. Fixture mode never populates this. */
  error?: string;
  /**
   * Select a profile in the sidebar. The bound profile is the only live
   * selection today — Phase-3 sub-agent profile placeholders render disabled
   * (see `HarnessSidebar`), so this is bookkeeping ahead of that phase.
   */
  selectProfile: (key: string) => void;
  /** Live-only: fetch the harness from the BFF. No-op in fixture mode. */
  loadHarness: () => void;
}

/**
 * Harness page state: the sidebar's profile selection, plus the live harness
 * view once loaded. One store per feature module (per the app's convention).
 * With no `VITE_BFF_URL` set, `harness` stays undefined and `loadHarness` is a
 * no-op, so the page falls back to fixtures; when the BFF is enabled,
 * `loadHarness` fetches `GET /api/harness` and a failure leaves any prior
 * data in place (the page shows a retry instead).
 */
export const useHarnessStore = create<HarnessStoreState>()((set) => ({
  selectedProfileKey: BOUND_PROFILE_KEY,
  harness: undefined,
  loading: false,
  error: undefined,

  selectProfile: (key) => set({ selectedProfileKey: key }),

  loadHarness: () => {
    if (!isBffEnabled()) return;

    set({ loading: true, error: undefined });
    getHarness()
      .then((harness) => {
        set({ harness, loading: false, error: undefined });
      })
      .catch((err: unknown) => {
        set({ loading: false, error: err instanceof Error ? err.message : t('harness.loadFailedMessage') });
      });
  },
}));
