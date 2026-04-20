import { useRouter } from 'next/router';
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import {
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import { Path } from '@/utils/enum';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import useRestRequest from './useRestRequest';
import {
  buildRuntimeSelectorStateRequestKey,
  fetchRuntimeSelectorState,
  peekRuntimeSelectorStatePayload,
  resolveRuntimeSelectorInitialLoading,
  type RuntimeSelectorState,
  type RuntimeSelectorStateRefetchResult,
} from './runtimeSelectorStateRequest';

export {
  buildRuntimeSelectorRequestOptions,
  buildRuntimeSelectorStateRequestKey,
  buildRuntimeSelectorStateUrl,
  resolveRuntimeSelectorInitialLoading,
  type RuntimeSelectorState,
  type RuntimeSelectorStateRefetchResult,
} from './runtimeSelectorStateRequest';

type RuntimeSelectorStateValue = {
  provided: boolean;
  runtimeSelectorState: RuntimeSelectorState | null;
  loading: boolean;
  initialLoading: boolean;
  refetch: () => Promise<RuntimeSelectorStateRefetchResult>;
};

const fallbackRefetch = async () =>
  ({
    data: { runtimeSelectorState: null },
  }) as RuntimeSelectorStateRefetchResult;

const RuntimeSelectorStateContext = createContext<RuntimeSelectorStateValue>({
  provided: false,
  runtimeSelectorState: null,
  loading: false,
  initialLoading: false,
  refetch: fallbackRefetch,
});

const useRuntimeSelectorStateRequest = ({
  skip,
  selector,
}: {
  skip: boolean;
  selector: ClientRuntimeScopeSelector;
}) => {
  const requestUrl = buildRuntimeSelectorStateRequestKey({
    skip,
    selector,
  });
  const initialData = requestUrl
    ? peekRuntimeSelectorStatePayload({ requestUrl })
    : null;

  const {
    data: runtimeSelectorState,
    loading,
    refetch: refetchState,
  } = useRestRequest<RuntimeSelectorState | null>({
    enabled: Boolean(requestUrl),
    auto: Boolean(requestUrl),
    initialData,
    requestKey: requestUrl,
    request: ({ signal }) =>
      fetchRuntimeSelectorState({ requestUrl: requestUrl as string, signal }),
  });

  const refetch = useCallback(async () => {
    const nextRuntimeSelectorState = await refetchState();
    return {
      data: {
        runtimeSelectorState: nextRuntimeSelectorState,
      },
    } as RuntimeSelectorStateRefetchResult;
  }, [refetchState]);

  return {
    runtimeSelectorState,
    loading,
    initialLoading: resolveRuntimeSelectorInitialLoading({
      loading,
      runtimeSelectorState,
    }),
    refetch,
  };
};

interface RuntimeSelectorStateProviderProps {
  children: ReactNode;
}

export const RuntimeSelectorStateProvider = ({
  children,
}: RuntimeSelectorStateProviderProps) => {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const skip =
    !runtimeScopeNavigation.hasRuntimeScope ||
    router.pathname === Path.Auth ||
    router.pathname === '/_error';
  const requestState = useRuntimeSelectorStateRequest({
    skip,
    selector: runtimeScopeNavigation.selector,
  });
  const contextValue = useMemo(
    () => ({
      provided: true,
      runtimeSelectorState: requestState.runtimeSelectorState,
      loading: skip ? false : requestState.loading,
      initialLoading: skip ? false : requestState.initialLoading,
      refetch: requestState.refetch,
    }),
    [
      requestState.initialLoading,
      requestState.loading,
      requestState.refetch,
      requestState.runtimeSelectorState,
      skip,
    ],
  );

  return (
    <RuntimeSelectorStateContext.Provider value={contextValue}>
      {children}
    </RuntimeSelectorStateContext.Provider>
  );
};

export default function useRuntimeSelectorState() {
  const contextValue = useContext(RuntimeSelectorStateContext);
  const fallbackRequest = useRuntimeSelectorStateRequest({
    skip: contextValue.provided,
    selector: resolveClientRuntimeScopeSelector(),
  });

  if (contextValue.provided) {
    return contextValue;
  }

  return {
    provided: false,
    runtimeSelectorState: fallbackRequest.runtimeSelectorState,
    loading: fallbackRequest.loading,
    initialLoading: fallbackRequest.initialLoading,
    refetch: fallbackRequest.refetch,
  };
}
