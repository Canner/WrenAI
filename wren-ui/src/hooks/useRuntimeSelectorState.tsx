import { useRouter } from 'next/router';
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import { parseRestJsonResponse } from '@/utils/rest';
import { Path } from '@/utils/enum';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import useRestRequest from './useRestRequest';

export type RuntimeSelectorState = {
  currentWorkspace?: {
    id: string;
    slug: string;
    name: string;
    kind?: string | null;
  } | null;
  workspaces: Array<{
    id: string;
    slug: string;
    name: string;
  }>;
  currentKnowledgeBase?: {
    id: string;
    slug: string;
    name: string;
    kind?: string | null;
    defaultKbSnapshotId?: string | null;
  } | null;
  currentKbSnapshot?: {
    id: string;
    snapshotKey: string;
    displayName: string;
    deployHash: string;
    status: string;
  } | null;
  knowledgeBases: Array<{
    id: string;
    slug: string;
    name: string;
    defaultKbSnapshotId?: string | null;
  }>;
  kbSnapshots: Array<{
    id: string;
    snapshotKey: string;
    displayName: string;
    deployHash: string;
    status: string;
  }>;
};

type RuntimeSelectorStateRefetchResult = {
  data: {
    runtimeSelectorState: RuntimeSelectorState | null;
  };
};

type RuntimeSelectorStateValue = {
  provided: boolean;
  runtimeSelectorState: RuntimeSelectorState | null;
  loading: boolean;
  initialLoading: boolean;
  refetch: () => Promise<RuntimeSelectorStateRefetchResult>;
};

export const buildRuntimeSelectorStateUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/runtime/scope/current', {}, selector);

export const buildRuntimeSelectorRequestOptions = ({
  signal,
}: {
  signal?: AbortSignal;
}) => ({
  method: 'GET' as const,
  signal,
});

const fallbackRefetch = async () =>
  ({
    data: { runtimeSelectorState: null },
  }) as RuntimeSelectorStateRefetchResult;

export const resolveRuntimeSelectorInitialLoading = ({
  loading,
  runtimeSelectorState,
}: {
  loading: boolean;
  runtimeSelectorState: RuntimeSelectorState | null;
}) => loading && runtimeSelectorState === null;

const RuntimeSelectorStateContext = createContext<RuntimeSelectorStateValue>({
  provided: false,
  runtimeSelectorState: null,
  loading: false,
  initialLoading: false,
  refetch: fallbackRefetch,
});

const fetchRuntimeSelectorState = async ({
  requestUrl,
  signal,
}: {
  requestUrl: string;
  signal: AbortSignal;
}) => {
  const response = await fetch(
    requestUrl,
    buildRuntimeSelectorRequestOptions({ signal }),
  );
  return parseRestJsonResponse<RuntimeSelectorState | null>(
    response,
    '加载运行时范围失败，请稍后重试。',
  );
};

const useRuntimeSelectorStateRequest = ({
  skip,
  selector,
}: {
  skip: boolean;
  selector: ClientRuntimeScopeSelector;
}) => {
  const requestUrl = useMemo(() => {
    if (skip) {
      return null;
    }

    return buildRuntimeSelectorStateUrl(selector);
  }, [
    selector.deployHash,
    selector.kbSnapshotId,
    selector.knowledgeBaseId,
    selector.runtimeScopeId,
    selector.workspaceId,
    skip,
  ]);

  const {
    data: runtimeSelectorState,
    loading,
    refetch: refetchState,
  } = useRestRequest<RuntimeSelectorState | null>({
    enabled: Boolean(requestUrl),
    auto: Boolean(requestUrl),
    initialData: null,
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

  const value = useMemo<RuntimeSelectorStateValue>(
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
    <RuntimeSelectorStateContext.Provider value={value}>
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
