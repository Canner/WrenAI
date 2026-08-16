import { create } from 'zustand';
import { isBffEnabled } from '@/bff/env';
import { getContextEnrichment, getContextFiles, getContextImpact, getContextOverview } from '@/bff/client';
import type { EnrichmentStatus } from '@/bff/client';
import type { ContextFileNode, ContextOverviewData, ImpactData } from './types';
import { t } from '@/i18n/strings';

let enrichmentRequestSequence = 0;

/** A polling response may arrive after a newer snapshot; timestamps are display data, never the ordering authority. */
function acceptsEnrichmentSnapshot(current: EnrichmentStatus | undefined, incoming: EnrichmentStatus): boolean {
  const previous = current?.run;
  const next = incoming.run;
  if (!previous) return true;
  // The active-binding polling contract intentionally omits stale runs; a
  // latest polling response must therefore clear an older local snapshot.
  if (!next) return true;
  if (next.bindingGeneration !== previous.bindingGeneration) return next.bindingGeneration > previous.bindingGeneration;
  // A later polling request owns run replacement; its request sequence is the
  // ordering authority when a fresh run resets its per-run version to 1.
  if (next.id !== previous.id) return true;
  return next.version >= previous.version;
}

/** Which canvas view the Context page currently shows. */
export type ContextViewMode = 'overview' | 'file' | 'impact';

interface ContextStoreState {
  viewMode: ContextViewMode;
  /** File tree key of the currently viewed file (drives `FileViewer`). */
  selectedFileKey?: string;
  /** Entity key of the current Impact view's seed (drives `ImpactView`). */
  impactSeedKey?: string;
  /** Live-fetched impact data (blast radius + broken pairs) per entity key, once loaded. Fixture mode never populates this. */
  liveImpactByKey: Record<string, ImpactData>;
  /** Set when the live impact fetch for the current seed key failed. */
  impactError?: string;
  /** Live-fetched semantic overview (models/relationships/measures/knowledge), once loaded. Fixture mode never populates this. */
  liveOverview?: ContextOverviewData;
  /** True while the live overview fetch is in flight. Always false in fixture mode. */
  overviewLoading: boolean;
  /** Set when the live overview fetch failed. Fixture mode never populates this. A prior successful fetch, if any, is left in place. */
  overviewError?: string;
  /** Live-fetched `wren_project` file tree, once loaded. Fixture mode never populates this. */
  liveFiles?: ContextFileNode[];
  /** True while the live file tree fetch is in flight. Always false in fixture mode. */
  filesLoading: boolean;
  /** Set when the live file tree fetch failed. Fixture mode never populates this. A prior successful fetch, if any, is left in place. */
  filesError?: string;
  /** Optional post-bind enrichment is loaded independently of the foundation overview. */
  enrichment?: EnrichmentStatus;
  enrichmentLoading: boolean;
  enrichmentError?: string;
  /** Select a file in the tree — shows its read-only content in the canvas. */
  selectFile: (key: string) => void;
  /** Return to the ER + knowledge overview. */
  showOverview: () => void;
  /** Show the Impact view for a given entity key — fetches live if the BFF is enabled. */
  showImpact: (seedKey: string) => void;
  /** Live-only: fetch the semantic overview from the BFF. No-op in fixture mode. */
  loadOverview: () => void;
  /** Live-only: fetch the `wren_project` file tree from the BFF. No-op in fixture mode. */
  loadFiles: () => void;
  loadEnrichment: () => void;
  /** Re-fetch canonical bound-project artifacts after returning from a native session. */
  refreshCanonical: () => void;
}

/**
 * Context page state: which canvas view is active and its selection. One
 * store per feature module (per the app's convention) — see `useHarnessStore`
 * for the sibling live-load pattern. With no `VITE_BFF_URL` set, everything is
 * fixture-driven and nothing here reaches a backend; when the BFF is enabled,
 * `loadOverview`/`loadFiles` fetch `GET /api/context/overview` and `GET
 * /api/context/files` (triggered on mount by `ContextPage`), and `showImpact`
 * fetches the seed's blast radius live via `GET /api/context/impact/:entityKey`.
 * A failed live fetch leaves any prior data in place — the page shows a retry
 * instead of blanking out what was already loaded.
 */
export const useContextStore = create<ContextStoreState>()((set, get) => ({
  viewMode: 'overview',
  selectedFileKey: undefined,
  impactSeedKey: undefined,
  liveImpactByKey: {},
  impactError: undefined,
  liveOverview: undefined,
  overviewLoading: false,
  overviewError: undefined,
  liveFiles: undefined,
  filesLoading: false,
  filesError: undefined,
  enrichment: undefined,
  enrichmentLoading: false,
  enrichmentError: undefined,

  selectFile: (key) => set({ viewMode: 'file', selectedFileKey: key }),
  showOverview: () => set({ viewMode: 'overview' }),
  showImpact: (seedKey) => {
    set({ viewMode: 'impact', impactSeedKey: seedKey, impactError: undefined });
    if (!isBffEnabled()) return;

    getContextImpact(seedKey)
      .then((impactData) => {
        set((s) => ({ liveImpactByKey: { ...s.liveImpactByKey, [seedKey]: impactData } }));
      })
      .catch((err: unknown) => {
        set({ impactError: err instanceof Error ? err.message : t('context.impactLoadFailedMessage') });
      });
  },

  loadOverview: () => {
    if (!isBffEnabled()) return;

    set({ overviewLoading: true, overviewError: undefined });
    getContextOverview()
      .then((overview) => {
        set({ liveOverview: overview, overviewLoading: false, overviewError: undefined });
      })
      .catch((err: unknown) => {
        set({ overviewLoading: false, overviewError: err instanceof Error ? err.message : t('context.overviewLoadFailedMessage') });
      });
  },

  loadFiles: () => {
    if (!isBffEnabled()) return;

    set({ filesLoading: true, filesError: undefined });
    getContextFiles()
      .then((files) => {
        set({ liveFiles: files, filesLoading: false, filesError: undefined });
      })
      .catch((err: unknown) => {
        set({ filesLoading: false, filesError: err instanceof Error ? err.message : t('context.filesLoadFailedMessage') });
      });
  },

  loadEnrichment: () => {
    if (!isBffEnabled() || typeof getContextEnrichment !== 'function') return;
    const requestSequence = ++enrichmentRequestSequence;
    set({ enrichmentLoading: true, enrichmentError: undefined });
    getContextEnrichment()
      .then((enrichment) => set((state) => {
        if (requestSequence !== enrichmentRequestSequence || !acceptsEnrichmentSnapshot(state.enrichment, enrichment)) return { enrichmentLoading: false };
        return { enrichment, enrichmentLoading: false, enrichmentError: undefined };
      }))
      .catch((err: unknown) => {
        if (requestSequence !== enrichmentRequestSequence) return;
        // Transport diagnostics are not stable UI/audit data. Keep this
        // reload-safe message bounded; action failures have their own
        // version-keyed, bounded presentation in EnrichmentPanel.
        void err;
        set({ enrichmentLoading: false, enrichmentError: t('context.enrichmentLoadFailed') });
      });
  },
  refreshCanonical: () => {
    get().loadOverview();
    get().loadFiles();
    get().loadEnrichment();
  },
}));
