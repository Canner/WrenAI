import { useCallback, useEffect, useRef } from 'react';
import {
  buildRuntimeScopeStateKey,
  hasExecutableRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import type { ModelSyncResponse } from '@/types/project';

import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import useRuntimeSelectorState from './useRuntimeSelectorState';
import { PollingRequestCoordinator } from './usePollingRequestLoop';
import useRestRequest from './useRestRequest';
import { fetchDeployStatus } from '@/utils/modelingRest';
import {
  normalizeDeployStatusRefetchResult,
  shouldContinueDeployStatusPolling,
  UNSYNCHRONIZED_RESULT,
} from './deployStatusRestHelpers';

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

export default function useDeployStatusRest(): DeployStatusResult {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeSelectorState = useRuntimeSelectorState();
  const pollingCoordinatorRef = useRef(new PollingRequestCoordinator());
  const pollIntervalRef = useRef<number | null>(null);
  const hasExecutableScope = hasExecutableRuntimeScopeSelector(
    runtimeScopeNavigation.selector,
  );
  const readyForRequest =
    hasExecutableScope && !runtimeSelectorState.initialLoading;
  const requestKey = buildDeployStatusRequestKey(
    readyForRequest ? runtimeScopeNavigation.selector : {},
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
    enabled: readyForRequest,
    auto: readyForRequest,
    initialData: undefined,
    requestKey,
    request: ({ signal }) =>
      fetchDeployStatus(runtimeScopeNavigation.selector, { signal }),
    mapResult: (modelSync) => ({ modelSync }),
  });

  const stopPolling = useCallback(() => {
    pollIntervalRef.current = null;
    pollingCoordinatorRef.current.stop();
  }, []);

  const refetch = useCallback(async () => {
    if (!hasExecutableScope) {
      stopPolling();
      setData(undefined);
      return UNSYNCHRONIZED_RESULT;
    }

    if (runtimeSelectorState.initialLoading) {
      return UNSYNCHRONIZED_RESULT;
    }

    return normalizeDeployStatusRefetchResult(await refetchState());
  }, [
    hasExecutableScope,
    refetchState,
    runtimeSelectorState.initialLoading,
    setData,
    stopPolling,
  ]);

  const schedulePoll = useCallback(() => {
    const intervalMs = pollIntervalRef.current;
    if (!shouldContinueDeployStatusPolling(intervalMs)) {
      return;
    }
    const pollingSession = pollingCoordinatorRef.current.begin();
    pollingSession.scheduleNext(() => {
      void refetch()
        .catch(() => null)
        .finally(() => {
          if (
            pollingSession.isCurrent() &&
            shouldContinueDeployStatusPolling(pollIntervalRef.current)
          ) {
            schedulePoll();
          }
        });
    }, intervalMs as number);
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
