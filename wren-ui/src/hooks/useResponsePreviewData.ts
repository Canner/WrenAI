import { ApolloError, useApolloClient } from '@apollo/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PreviewDataDocument,
  type PreviewDataMutation,
  type PreviewDataMutationVariables,
} from '@/apollo/client/graphql/home.generated';

type PreviewDataPayload = PreviewDataMutation['previewData'];
type PreviewDataEnvelope = {
  previewData?: PreviewDataPayload;
};

type CacheEntry = {
  data?: PreviewDataPayload;
  error?: ApolloError;
  loading: boolean;
  promise?: Promise<PreviewDataPayload>;
  listeners: Set<() => void>;
  updatedAt?: number;
  lastAccessedAt: number;
};

const cache = new Map<number, CacheEntry>();
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
    let oldestKey: number | null = null;
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
    if (oldestKey == null) {
      break;
    }
    cache.delete(oldestKey);
  }
};

const getOrCreateEntry = (responseId: number): CacheEntry => {
  pruneCache();
  const existing = cache.get(responseId);
  if (existing) {
    existing.lastAccessedAt = Date.now();
    return existing;
  }
  const next: CacheEntry = {
    loading: false,
    listeners: new Set(),
    lastAccessedAt: Date.now(),
  };
  cache.set(responseId, next);
  return next;
};

const emit = (responseId: number) => {
  const entry = cache.get(responseId);
  if (!entry) return;
  entry.listeners.forEach((listener) => listener());
};

export const clearResponsePreviewDataCache = (responseId?: number) => {
  if (typeof responseId === 'number') {
    cache.delete(responseId);
    return;
  }
  cache.clear();
};

export default function useResponsePreviewData(responseId?: number | null) {
  const client = useApolloClient();
  const cacheKey = typeof responseId === 'number' ? responseId : null;
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (cacheKey == null) return;
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
      if (cacheKey == null) {
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

      const mutationPromise = client
        .mutate<PreviewDataMutation, PreviewDataMutationVariables>({
          mutation: PreviewDataDocument,
          variables: {
            where: { responseId: cacheKey },
          },
          fetchPolicy: force ? 'no-cache' : 'network-only',
        })
        .then((result) => {
          target.data = result.data?.previewData;
          target.loading = false;
          target.promise = undefined;
          target.updatedAt = Date.now();
          target.lastAccessedAt = Date.now();
          pruneCache();
          emit(cacheKey);
          return target.data;
        })
        .catch((error) => {
          target.error =
            error instanceof ApolloError
              ? error
              : new ApolloError({ errorMessage: String(error) });
          target.loading = false;
          target.promise = undefined;
          target.lastAccessedAt = Date.now();
          emit(cacheKey);
          throw target.error;
        });

      target.promise = mutationPromise;
      return mutationPromise;
    },
    [cacheKey, client],
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
