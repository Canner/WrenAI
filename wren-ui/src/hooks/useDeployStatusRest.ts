import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelSyncResponse } from '@/apollo/client/graphql/__types__';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import { fetchDeployStatus } from '@/utils/modelingRest';

export type DeployStatusResult = {
  data?: {
    modelSync: ModelSyncResponse;
  };
  loading: boolean;
  refetch: () => Promise<{
    data: {
      modelSync: ModelSyncResponse;
    };
  }>;
  startPolling: (intervalMs: number) => void;
  stopPolling: () => void;
};

export default function useDeployStatusRest(): DeployStatusResult {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const [data, setData] = useState<{ modelSync: ModelSyncResponse }>();
  const [loading, setLoading] = useState(false);

  const stopPolling = useCallback(() => {
    pollIntervalRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const modelSync = await fetchDeployStatus(
        runtimeScopeNavigation.selector,
      );
      const result = { data: { modelSync } };
      if (requestIdRef.current === requestId) {
        setData(result.data);
      }
      return result;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [runtimeScopeNavigation.selector]);

  const schedulePoll = useCallback(() => {
    if (!pollIntervalRef.current) {
      return;
    }
    timerRef.current = setTimeout(() => {
      void refetch()
        .catch(() => null)
        .finally(() => {
          if (pollIntervalRef.current) {
            schedulePoll();
          }
        });
    }, pollIntervalRef.current);
  }, [refetch]);

  const startPolling = useCallback(
    (intervalMs: number) => {
      stopPolling();
      pollIntervalRef.current = intervalMs;
      schedulePoll();
    },
    [schedulePoll, stopPolling],
  );

  useEffect(() => {
    void refetch().catch(() => null);
  }, [refetch]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    data,
    loading,
    refetch,
    startPolling,
    stopPolling,
  };
}
