import { create } from 'zustand';
import { isBffEnabled } from '@/bff/env';
import { listEvalRuns, getEvalRun } from '@/bff/client';
import { fixtureEvalRuns, fixtureComponentScores } from './fixtures';
import type { ComponentScore, EvalRun } from './types';
import { t } from '@/i18n/strings';

interface EvalStoreState {
  /** Run id of the currently viewed eval run. */
  selectedRunId: string;
  /** The runs shown in the sidebar + score trend. Defaults to fixtures; replaced by live data once loaded. */
  runs: EvalRun[];
  /** By-component scores per run id, fetched lazily in live mode. */
  componentScoresByRunId: Record<string, ComponentScore[]>;
  /** True while the live run list fetch is in flight. Always false in fixture mode. */
  loadingRuns: boolean;
  /** Set when the live run list fetch failed. Fixture mode never populates this. */
  error?: string;
  /** Select a run in the sidebar — shows its global detail in the canvas. */
  selectRun: (id: string) => void;
  /** Live-only: fetch the run list from the BFF. No-op in fixture mode. */
  loadRuns: () => void;
}

/**
 * Eval page state: which run the sidebar has selected, plus the run list and
 * per-run component scores. One store per feature module (per the app's
 * convention) — see `useHarnessStore` for the sibling pattern. With no
 * `VITE_BFF_URL` set, `runs`/`componentScoresByRunId` stay at their fixture
 * defaults and `loadRuns` is a no-op; when the BFF is enabled, `loadRuns`
 * fetches `GET /api/eval/runs` and `selectRun` lazily fetches `GET
 * /api/eval/runs/:id` for scores not already cached.
 */
export const useEvalStore = create<EvalStoreState>()((set, get) => ({
  selectedRunId: fixtureEvalRuns[0].id,
  runs: fixtureEvalRuns,
  componentScoresByRunId: fixtureComponentScores,
  loadingRuns: false,
  error: undefined,

  selectRun: (id) => {
    set({ selectedRunId: id });
    if (!isBffEnabled() || get().componentScoresByRunId[id]) return;

    getEvalRun(id)
      .then(({ componentScores }) => {
        set((s) => ({ componentScoresByRunId: { ...s.componentScoresByRunId, [id]: componentScores } }));
      })
      .catch(() => {
        // Best-effort — the breakdown table just stays empty for this run.
      });
  },

  loadRuns: () => {
    if (!isBffEnabled()) return;

    set({ loadingRuns: true, error: undefined });
    listEvalRuns()
      .then((runs) => {
        set((s) => ({
          runs,
          loadingRuns: false,
          error: undefined,
          selectedRunId: runs.some((r) => r.id === s.selectedRunId) ? s.selectedRunId : (runs[0]?.id ?? s.selectedRunId),
        }));
        const id = get().selectedRunId;
        if (id && !get().componentScoresByRunId[id]) get().selectRun(id);
      })
      .catch((err: unknown) => {
        set({ loadingRuns: false, error: err instanceof Error ? err.message : t('eval.loadFailedMessage') });
      });
  },
}));
