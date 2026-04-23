import { useCallback, useEffect, useMemo, useState } from 'react';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import {
  getThreadResponsePreviewData,
  type PreviewDataPayload,
} from '@/utils/homeRest';
import { isAbortRequestError } from '@/utils/abort';
import {
  buildRuntimeScopeStateKey,
  hasExplicitRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';

type PreviewDataEnvelope = {
  previewData?: PreviewDataPayload;
};

type CacheEntry = {
  data?: PreviewDataPayload;
  error?: Error;
  loading: boolean;
  promise?: Promise<PreviewDataPayload | undefined>;
  listeners: Set<() => void>;
  updatedAt?: number;
  lastAccessedAt: number;
};

const cache = new Map<string, CacheEntry>();
const PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PREVIEW_CACHE_ENTRIES = 50;

const isExpired = (entry: CacheEntry) =>
  !!entry.updatedAt && Date.now() - entry.updatedAt > PREVIEW_CACHE_TTL_MS;

const pruneCache = () => {
  for (const [key, entry] of cache.entries()) {
    if (!entry.loading && !entry.promise && isExpired(entry)) {
      cache.delete(key);
    }
  }

  while (cache.size > MAX_PREVIEW_CACHE_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestAccess = Number.POSITIVE_INFINITY;
    for (const [key, entry] of cache.entries()) {
      if (entry.loading || entry.promise) {
        continue;
      }
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
};

const getCacheKey = (
  runtimeScopeSelector: ClientRuntimeScopeSelector,
  responseId: number,
) =>
  `${hasExplicitRuntimeScopeSelector(runtimeScopeSelector) ? buildRuntimeScopeStateKey(runtimeScopeSelector) : 'global'}:${responseId}`;

const getOrCreateEntry = (cacheKey: string): CacheEntry => {
  pruneCache();
  const existing = cache.get(cacheKey);
  if (existing) {
    existing.lastAccessedAt = Date.now();
    return existing;
  }

  const next: CacheEntry = {
    loading: false,
    listeners: new Set(),
    lastAccessedAt: Date.now(),
  };
  cache.set(cacheKey, next);
  return next;
};

const emit = (cacheKey: string) => {
  const entry = cache.get(cacheKey);
  if (!entry) return;
  entry.listeners.forEach((listener) => listener());
};

export const clearResponsePreviewDataCache = (
  responseId?: number,
  runtimeScopeSelector?: ClientRuntimeScopeSelector,
) => {
  if (typeof responseId === 'number') {
    if (runtimeScopeSelector) {
      cache.delete(getCacheKey(runtimeScopeSelector, responseId));
      return;
    }

    Array.from(cache.keys())
      .filter((key) => key.endsWith(`:${responseId}`))
      .forEach((key) => cache.delete(key));
    return;
  }

  cache.clear();
};

export default function useResponsePreviewData(
  responseId?: number | null,
  runtimeScopeSelectorOverride?: ClientRuntimeScopeSelector,
) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopeSelector = useMemo(
    () => ({
      workspaceId:
        runtimeScopeSelectorOverride?.workspaceId ||
        runtimeScopeNavigation.selector.workspaceId,
      knowledgeBaseId:
        runtimeScopeSelectorOverride?.knowledgeBaseId ||
        runtimeScopeNavigation.selector.knowledgeBaseId,
      kbSnapshotId:
        runtimeScopeSelectorOverride?.kbSnapshotId ||
        runtimeScopeNavigation.selector.kbSnapshotId,
      deployHash:
        runtimeScopeSelectorOverride?.deployHash ||
        runtimeScopeNavigation.selector.deployHash,
      runtimeScopeId:
        runtimeScopeSelectorOverride?.runtimeScopeId ||
        runtimeScopeNavigation.selector.runtimeScopeId,
    }),
    [
      runtimeScopeNavigation.selector.deployHash,
      runtimeScopeNavigation.selector.kbSnapshotId,
      runtimeScopeNavigation.selector.knowledgeBaseId,
      runtimeScopeNavigation.selector.runtimeScopeId,
      runtimeScopeNavigation.selector.workspaceId,
      runtimeScopeSelectorOverride?.deployHash,
      runtimeScopeSelectorOverride?.kbSnapshotId,
      runtimeScopeSelectorOverride?.knowledgeBaseId,
      runtimeScopeSelectorOverride?.runtimeScopeId,
      runtimeScopeSelectorOverride?.workspaceId,
    ],
  );
  const cacheKey =
    typeof responseId === 'number'
      ? getCacheKey(runtimeScopeSelector, responseId)
      : null;
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!cacheKey) return;
    const entry = getOrCreateEntry(cacheKey);
    const listener = () => forceUpdate((value) => value + 1);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }, [cacheKey]);

  const entry = useMemo(
    () => (cacheKey == null ? null : getOrCreateEntry(cacheKey)),
    [cacheKey],
  );

  const runFetch = useCallback(
    async (force = false) => {
      if (cacheKey == null || responseId == null) {
        return undefined;
      }

      const target = getOrCreateEntry(cacheKey);
      if (!force && target.data && !isExpired(target)) {
        return target.data;
      }
      if (target.data && isExpired(target)) {
        target.data = undefined;
      }
      if (!force && target.promise) {
        return target.promise;
      }

      target.loading = true;
      target.error = undefined;
      emit(cacheKey);

      const request = getThreadResponsePreviewData(
        runtimeScopeSelector,
        responseId,
      )
        .then((payload) => {
          target.data = payload;
          target.loading = false;
          target.promise = undefined;
          target.updatedAt = Date.now();
          target.lastAccessedAt = Date.now();
          pruneCache();
          emit(cacheKey);
          return target.data;
        })
        .catch((error) => {
          const normalizedError =
            error instanceof Error
              ? error
              : new Error(String(error || '加载预览数据失败，请稍后重试。'));
          target.loading = false;
          target.promise = undefined;
          target.lastAccessedAt = Date.now();
          if (
            isAbortRequestError(error) ||
            isAbortRequestError(normalizedError)
          ) {
            target.error = undefined;
            emit(cacheKey);
            return undefined;
          }
          target.error = normalizedError;
          emit(cacheKey);
          throw target.error;
        });

      target.promise = request;
      return request;
    },
    [cacheKey, responseId, runtimeScopeSelector],
  );

  return {
    data: entry?.data
      ? ({
          previewData: entry.data,
        } as PreviewDataEnvelope)
      : undefined,
    previewData: entry?.data,
    error: entry?.error,
    loading: entry?.loading || false,
    called: !!entry?.data || !!entry?.promise,
    ensureLoaded: () => runFetch(false),
    refetch: () => runFetch(true),
  };
}
