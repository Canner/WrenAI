import { useEffect, useRef, useState } from 'react';

export const shouldSyncKnowledgeRuntimeScopeData = ({
  runtimeScopeKey,
  lastSyncedRuntimeScopeKey,
}: {
  runtimeScopeKey?: string | null;
  lastSyncedRuntimeScopeKey?: string | null;
}) =>
  Boolean(
    runtimeScopeKey && runtimeScopeKey !== (lastSyncedRuntimeScopeKey || null),
  );

export const shouldPrimeKnowledgeRuntimeScopeData = ({
  runtimeScopeKey,
  lastSyncedRuntimeScopeKey,
}: {
  runtimeScopeKey?: string | null;
  lastSyncedRuntimeScopeKey?: string | null;
}) => Boolean(runtimeScopeKey && !lastSyncedRuntimeScopeKey);

export default function useKnowledgeRuntimeSync({
  runtimeSyncScopeKey,
  sync,
}: {
  runtimeSyncScopeKey?: string | null;
  sync: () => Promise<unknown>;
}) {
  const [runtimeSyncing, setRuntimeSyncing] = useState(false);
  const lastRuntimeSyncScopeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!runtimeSyncScopeKey) {
      lastRuntimeSyncScopeKeyRef.current = null;
      setRuntimeSyncing(false);
      return;
    }

    if (
      shouldPrimeKnowledgeRuntimeScopeData({
        runtimeScopeKey: runtimeSyncScopeKey,
        lastSyncedRuntimeScopeKey: lastRuntimeSyncScopeKeyRef.current,
      })
    ) {
      lastRuntimeSyncScopeKeyRef.current = runtimeSyncScopeKey;
      setRuntimeSyncing(false);
      return;
    }

    if (
      !shouldSyncKnowledgeRuntimeScopeData({
        runtimeScopeKey: runtimeSyncScopeKey,
        lastSyncedRuntimeScopeKey: lastRuntimeSyncScopeKeyRef.current,
      })
    ) {
      return;
    }

    lastRuntimeSyncScopeKeyRef.current = runtimeSyncScopeKey;

    let cancelled = false;
    setRuntimeSyncing(true);
    void sync().finally(() => {
      if (!cancelled) {
        setRuntimeSyncing(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [runtimeSyncScopeKey, sync]);

  return {
    runtimeSyncing,
  };
}
