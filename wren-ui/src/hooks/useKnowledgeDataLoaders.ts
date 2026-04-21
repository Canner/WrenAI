import { useCallback } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import {
  loadKnowledgeBaseList,
  loadKnowledgeConnectors,
} from '@/utils/runtimePagePrefetch';

type RuntimeScopeUrlBuilder = (
  path: string,
  query?: Record<string, string | number | undefined>,
  selector?: {
    workspaceId?: string;
    knowledgeBaseId?: string;
    kbSnapshotId?: string;
    deployHash?: string;
    runtimeScopeId?: string;
  },
) => string;

type RuntimeScopeSelector = {
  workspaceId?: string;
  knowledgeBaseId?: string;
  kbSnapshotId?: string;
  deployHash?: string;
  runtimeScopeId?: string;
};

export const resolveWorkspaceConnectorSelector = (
  selector?: RuntimeScopeSelector,
): RuntimeScopeSelector | undefined =>
  selector?.workspaceId ? { workspaceId: selector.workspaceId } : undefined;

export const normalizeKnowledgeListPayload = <T>(payload: unknown): T[] =>
  Array.isArray(payload) ? (payload as T[]) : [];

export const resolveKnowledgeLoadErrorMessage = (
  error: unknown,
  fallbackMessage: string,
) =>
  error instanceof Error && error.message ? error.message : fallbackMessage;

export default function useKnowledgeDataLoaders<TKnowledgeBase, TConnector>({
  buildRuntimeScopeUrl,
}: {
  buildRuntimeScopeUrl: RuntimeScopeUrlBuilder;
}) {
  const fetchKnowledgeBaseList = useCallback(async (url: string) => {
    const payload = await loadKnowledgeBaseList<TKnowledgeBase[]>(url);
    return normalizeKnowledgeListPayload<TKnowledgeBase>(payload);
  }, []);

  const handleKnowledgeBaseLoadError = useCallback((error: unknown) => {
    message.error(resolveKnowledgeLoadErrorMessage(error, '加载知识库失败'));
  }, []);

  const fetchConnectors = useCallback(
    async (selector?: RuntimeScopeSelector) => {
      const payload = await loadKnowledgeConnectors<TConnector[]>(
        buildRuntimeScopeUrl(
          '/api/v1/connectors',
          {},
          resolveWorkspaceConnectorSelector(selector),
        ),
      );
      return normalizeKnowledgeListPayload<TConnector>(payload);
    },
    [buildRuntimeScopeUrl],
  );

  const handleConnectorLoadError = useCallback((error: unknown) => {
    message.error(resolveKnowledgeLoadErrorMessage(error, '加载连接器失败'));
  }, []);

  return {
    fetchKnowledgeBaseList,
    handleKnowledgeBaseLoadError,
    fetchConnectors,
    handleConnectorLoadError,
  };
}
