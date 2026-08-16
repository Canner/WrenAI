import { create } from 'zustand';
import { isBffEnabled } from '@/bff/env';
import { listArtifacts, getArtifact, postArtifactPublish, postArtifactUnsave, postRetainedArtifactUnsave } from '@/bff/client';
import { fixtureArtifacts } from './fixtures';
import type { Artifact, ArtifactPublish, ArtifactSummary } from './types';
import { t } from '@/i18n/strings';

interface ArtifactsStoreState {
  /** Key of the currently viewed artifact. */
  selectedKey: string;
  /** The artifacts shown in the sidebar. Defaults to fixtures; replaced by live data once loaded. */
  summaries: ArtifactSummary[];
  /** Per-kind detail, fetched lazily in live mode. */
  detailsByKey: Record<string, Artifact>;
  /** Set when `loadArtifacts` (the list fetch) fails. Fixture mode never populates this. */
  error?: string;
  /** Set when `select`'s per-artifact detail fetch fails. Fixture mode never populates this. */
  detailError?: string;
  /** Select an artifact in the sidebar — shows its per-kind detail in the canvas. */
  select: (key: string) => void;
  /** Live-only: fetch the artifact list from the BFF. No-op in fixture mode. */
  loadArtifacts: () => void;
  /** Publish (share) an artifact: live POST when the BFF is enabled, otherwise a local optimistic publish. */
  publish: (key: string) => void;
  /**
   * Unpin (un-save) an artifact from the Artifacts page: live POST when the
   * BFF is enabled, otherwise a local-only removal. Either way, the artifact
   * leaves `summaries`/`detailsByKey` — its row and content are untouched
   * server-side (see `postArtifactUnsave`), only this page's own state
   * updates. If the unpinned artifact was selected, selection falls back to
   * another remaining artifact (or none), same pattern as `loadArtifacts`.
   */
  unpin: (key: string) => void;
}

function detailsIndex(artifacts: Artifact[]): Record<string, Artifact> {
  return Object.fromEntries(artifacts.map((a) => [a.key, a]));
}

function withPublish<T extends { publish?: ArtifactPublish }>(item: T, publish: ArtifactPublish): T {
  return { ...item, publish };
}

/**
 * Artifacts page state: which artifact the sidebar has selected, plus the
 * artifact list and per-artifact detail. One store per feature module (per
 * the app's convention) — mirrors `useEvalStore`'s runs/componentScoresByRunId
 * split. With no `VITE_BFF_URL` set, `summaries`/`detailsByKey` stay at their
 * fixture defaults and `loadArtifacts` is a no-op; when the BFF is enabled,
 * `loadArtifacts` fetches `GET /api/artifacts` and `select` lazily fetches
 * `GET /api/artifacts/:key` for detail not already cached. `publish` always
 * updates local state optimistically; in live mode it also POSTs to the BFF.
 */
export const useArtifactsStore = create<ArtifactsStoreState>()((set, get) => ({
  selectedKey: fixtureArtifacts[0]?.key ?? '',
  summaries: fixtureArtifacts,
  detailsByKey: detailsIndex(fixtureArtifacts),
  error: undefined,
  detailError: undefined,

  select: (key) => {
    set({ selectedKey: key, detailError: undefined });
    if (!isBffEnabled() || get().detailsByKey[key]) return;

    getArtifact(key)
      .then((artifact) => {
        set((s) => ({ detailsByKey: { ...s.detailsByKey, [artifact.key]: artifact }, detailError: undefined }));
      })
      .catch((err: unknown) => {
        set({ detailError: err instanceof Error ? err.message : t('artifacts.detailLoadFailedMessage') });
      });
  },

  loadArtifacts: () => {
    if (!isBffEnabled()) return;

    listArtifacts()
      .then((summaries) => {
        set((s) => ({
          summaries,
          error: undefined,
          selectedKey: summaries.some((a) => a.key === s.selectedKey)
            ? s.selectedKey
            : (summaries[0]?.key ?? s.selectedKey),
        }));
        const key = get().selectedKey;
        if (key && !get().detailsByKey[key]) get().select(key);
      })
      .catch((err: unknown) => {
        set({ error: err instanceof Error ? err.message : t('artifacts.loadFailedMessage') });
      });
  },

  publish: (key) => {
    const item = get().summaries.find((a) => a.key === key);
    const sessionId = item?.sessionId;

    if (isBffEnabled() && sessionId) {
      postArtifactPublish(sessionId, key)
        .then((publish) => {
          set((s) => ({
            summaries: s.summaries.map((a) => (a.key === key ? withPublish(a, publish) : a)),
            detailsByKey: s.detailsByKey[key]
              ? { ...s.detailsByKey, [key]: withPublish(s.detailsByKey[key], publish) }
              : s.detailsByKey,
          }));
        })
        .catch(() => {
          // Best-effort — leave the artifact unpublished on failure.
        });
      return;
    }

    // Fixture mode, or a live artifact with no sessionId (shouldn't happen —
    // the BFF always includes one): optimistic local publish only.
    const publish: ArtifactPublish = { link: `https://share.genbi.example/${key}`, scope: 'workspace' };
    set((s) => ({
      summaries: s.summaries.map((a) => (a.key === key && !a.publish ? withPublish(a, publish) : a)),
      detailsByKey:
        s.detailsByKey[key] && !s.detailsByKey[key].publish
          ? { ...s.detailsByKey, [key]: withPublish(s.detailsByKey[key], publish) }
          : s.detailsByKey,
    }));
  },

  unpin: (key) => {
    const item = get().summaries.find((a) => a.key === key);
    const sessionId = item?.sessionId;

    const removeLocally = () => {
      set((s) => {
        const summaries = s.summaries.filter((a) => a.key !== key);
        const detailsByKey = { ...s.detailsByKey };
        delete detailsByKey[key];
        return {
          summaries,
          detailsByKey,
          selectedKey: s.selectedKey === key ? (summaries[0]?.key ?? '') : s.selectedKey,
        };
      });
    };

    if (isBffEnabled() && sessionId) {
      const native = item?.nativeSessionId !== undefined;
      (native ? postRetainedArtifactUnsave(key) : postArtifactUnsave(sessionId, key))
        .then(removeLocally)
        .catch(() => {
          // Best-effort — leave the artifact listed on failure.
        });
      return;
    }

    // Fixture mode, or a live artifact with no sessionId (shouldn't happen —
    // the BFF always includes one): optimistic local removal only.
    removeLocally();
  },
}));
