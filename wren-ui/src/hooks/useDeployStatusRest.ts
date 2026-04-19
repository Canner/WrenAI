import { useCallback, useEffect, useRef } from 'react';
import {
  buildRuntimeScopeStateKey,
  hasExecutableRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import type { ModelSyncResponse } from '@/types/project';

import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import useRestRequest from './useRestRequest';
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

export const buildDeployStatusRequestKey = (
  selector: Parameters<typeof hasExecutableRuntimeScopeSelector>[0],
) =>
  hasExecutableRuntimeScopeSelector(selector)
    ? buildRuntimeScopeStateKey(selector)
    : null;

const UNSYNCHRONIZED_RESULT = {
  data: {
    modelSync: {
      status: 'UNSYNCRONIZED',
    } as ModelSyncResponse,
  },
};

export default function useDeployStatusRest(): DeployStatusResult {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const hasExecutableScope = hasExecutableRuntimeScopeSelector(
    runtimeScopeNavigation.selector,
  );
  const requestKey = buildDeployStatusRequestKey(
    runtimeScopeNavigation.selector,
  );

  const {
    data,
    loading,
    refetch: refetchState,
    setData,
  } = useRestRequest<
    { modelSync: ModelSyncResponse } | undefined,
    ModelSyncResponse
  >({
    enabled: hasExecutableScope,
    auto: true,
    initialData: undefined,
    requestKey,
    request: ({ signal }) =>
      fetchDeployStatus(runtimeScopeNavigation.selector, { signal }),
    mapResult: (modelSync) => ({ modelSync }),
  });

  const stopPolling = useCallback(() => {
    pollIntervalRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const refetch = useCallback(async () => {
    if (!hasExecutableScope) {
      stopPolling();
      setData(undefined);
      return UNSYNCHRONIZED_RESULT;
    }

    const nextData = await refetchState();
    return {
      data:
        nextData ||
        ({
          modelSync: UNSYNCHRONIZED_RESULT.data.modelSync,
        } as { modelSync: ModelSyncResponse }),
    };
  }, [hasExecutableScope, refetchState, setData, stopPolling]);

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
