import { useRouter } from 'next/router';
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';
import { parseRestJsonResponse } from '@/utils/rest';
import { Path } from '@/utils/enum';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';

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

const RuntimeSelectorStateContext = createContext<RuntimeSelectorStateValue>({
  provided: false,
  runtimeSelectorState: null,
  loading: false,
  refetch: fallbackRefetch,
});

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
  const initialState = useMemo(
    () => ({
      runtimeSelectorState: null as RuntimeSelectorState | null,
      loading: Boolean(requestUrl),
    }),
    [requestUrl],
  );
  const [runtimeSelectorState, setRuntimeSelectorState] = useState(
    initialState.runtimeSelectorState,
  );
  const [loading, setLoading] = useState(initialState.loading);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!requestUrl) {
      setRuntimeSelectorState(null);
      setLoading(false);
      return fallbackRefetch();
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);

    try {
      const response = await fetch(
        requestUrl,
        buildRuntimeSelectorRequestOptions({}),
      );
      const payload = await parseRestJsonResponse<RuntimeSelectorState | null>(
        response,
        '加载运行时范围失败，请稍后重试。',
      );

      if (requestIdRef.current === requestId) {
        setRuntimeSelectorState(payload);
      }

      return {
        data: {
          runtimeSelectorState: payload,
        },
      } as RuntimeSelectorStateRefetchResult;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [requestUrl]);

  useEffect(() => {
    if (!requestUrl) {
      setRuntimeSelectorState(null);
      setLoading(false);
      return;
    }

    void refetch().catch(() => null);
  }, [refetch, requestUrl]);

  return {
    runtimeSelectorState,
    loading,
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
      refetch: requestState.refetch,
    }),
    [
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
    refetch: fallbackRequest.refetch,
  };
}
