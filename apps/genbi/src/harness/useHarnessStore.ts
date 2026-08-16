import { create } from 'zustand';
import { isBffEnabled } from '@/bff/env';
import { getHarness } from '@/bff/client';
import type { HarnessPurpose, HarnessView } from './types';
import { t } from '@/i18n/strings';

export const HARNESS_PURPOSES: readonly HarnessPurpose[] = ['setup', 'analysis', 'context_enrichment'];

let latestRequest = 0;

interface HarnessStoreState {
  /** Key of the currently selected profile in the sidebar's profile selector. */
  selectedPurpose: HarnessPurpose;
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
  selectProfile: (purpose: HarnessPurpose) => void;
  /** Live-only: fetch the harness from the BFF. No-op in fixture mode. */
  loadHarness: () => void;
}

/**
 * Harness page state: the sidebar's profile selection, plus the live harness
 * view once loaded. One store per feature module (per the app's convention).
 * With no `VITE_BFF_URL` set, `harness` stays undefined and `loadHarness` is a
 * no-op, so the page falls back to fixtures; when the BFF is enabled,
 * `loadHarness` fetches the selected purpose from `GET /api/harness`; a
 * request that is late for a prior selection cannot replace the active view.
 */
export const useHarnessStore = create<HarnessStoreState>()((set, get) => ({
  selectedPurpose: 'analysis',
  harness: undefined,
  loading: false,
  error: undefined,

  selectProfile: (purpose) => {
    if (!HARNESS_PURPOSES.includes(purpose)) return;
    set({ selectedPurpose: purpose, harness: undefined, loading: false, error: undefined });
    get().loadHarness();
  },

  loadHarness: () => {
    if (!isBffEnabled()) return;

    const purpose = get().selectedPurpose;
    const request = ++latestRequest;
    set({ loading: true, error: undefined });
    getHarness(purpose)
      .then((harness) => {
        if (request !== latestRequest || get().selectedPurpose !== purpose) return;
        set({ harness, loading: false, error: undefined });
      })
      .catch((err: unknown) => {
        if (request !== latestRequest || get().selectedPurpose !== purpose) return;
        set({ loading: false, error: err instanceof Error ? err.message : t('harness.loadFailedMessage') });
      });
  },
}));
