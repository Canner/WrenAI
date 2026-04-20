import { useCallback, useEffect, useMemo } from 'react';
import type { DiagramResponse } from '@/types/modeling';
import useRestRequest from './useRestRequest';
import {
  KNOWLEDGE_DIAGRAM_QUERY_FETCH_POLICY,
  buildKnowledgeDiagramUrl,
  loadKnowledgeDiagramPayload,
  peekKnowledgeDiagramPayload,
} from '@/utils/knowledgeDiagramRest';

type RuntimeScopeSelector = {
  workspaceId?: string;
  knowledgeBaseId?: string;
  kbSnapshotId?: string;
  deployHash?: string;
  runtimeScopeId?: string;
};

export const shouldFetchKnowledgeDiagram = ({
  hasRuntimeScope,
  routeKnowledgeBaseId,
  routeKbSnapshotId,
}: {
  hasRuntimeScope: boolean;
  routeKnowledgeBaseId?: string;
  routeKbSnapshotId?: string;
}) => Boolean(hasRuntimeScope && routeKnowledgeBaseId && routeKbSnapshotId);

export const resolveKnowledgeDiagramScopeKey = ({
  hasRuntimeScope,
  routeKnowledgeBaseId,
  routeKbSnapshotId,
  effectiveRuntimeSelector,
}: {
  hasRuntimeScope: boolean;
  routeKnowledgeBaseId?: string;
  routeKbSnapshotId?: string;
  effectiveRuntimeSelector: RuntimeScopeSelector;
}) => {
  if (
    !shouldFetchKnowledgeDiagram({
      hasRuntimeScope,
      routeKnowledgeBaseId,
      routeKbSnapshotId,
    })
  ) {
    return null;
  }

  return [
    effectiveRuntimeSelector.workspaceId || '',
    routeKnowledgeBaseId || effectiveRuntimeSelector.knowledgeBaseId || '',
    routeKbSnapshotId || effectiveRuntimeSelector.kbSnapshotId || '',
    effectiveRuntimeSelector.deployHash || '',
    effectiveRuntimeSelector.runtimeScopeId || '',
  ].join('|');
};

export const shouldClearScopedDiagramData = ({
  previousScopeKey,
  nextScopeKey,
  hasCachedDiagramData,
}: {
  previousScopeKey?: string | null;
  nextScopeKey?: string | null;
  hasCachedDiagramData: boolean;
}) =>
  Boolean(
    previousScopeKey &&
    nextScopeKey &&
    previousScopeKey !== nextScopeKey &&
    !hasCachedDiagramData,
  );

export const buildKnowledgeDiagramRequestKey = ({
  diagramScopeKey,
  effectiveRuntimeSelector,
}: {
  diagramScopeKey?: string | null;
  effectiveRuntimeSelector: RuntimeScopeSelector;
}) =>
  diagramScopeKey ? buildKnowledgeDiagramUrl(effectiveRuntimeSelector) : null;

export default function useKnowledgeDiagramData({
  hasRuntimeScope,
  routeKnowledgeBaseId,
  routeKbSnapshotId,
  effectiveRuntimeSelector,
}: {
  hasRuntimeScope: boolean;
  routeKnowledgeBaseId?: string;
  routeKbSnapshotId?: string;
  effectiveRuntimeSelector: RuntimeScopeSelector;
}) {
  const diagramScopeKey = useMemo(
    () =>
      resolveKnowledgeDiagramScopeKey({
        hasRuntimeScope,
        routeKnowledgeBaseId,
        routeKbSnapshotId,
        effectiveRuntimeSelector,
      }),
    [
      effectiveRuntimeSelector.deployHash,
      effectiveRuntimeSelector.kbSnapshotId,
      effectiveRuntimeSelector.knowledgeBaseId,
      effectiveRuntimeSelector.runtimeScopeId,
      effectiveRuntimeSelector.workspaceId,
      hasRuntimeScope,
      routeKbSnapshotId,
      routeKnowledgeBaseId,
    ],
  );
  const requestUrl = useMemo(
    () =>
      buildKnowledgeDiagramRequestKey({
        diagramScopeKey,
        effectiveRuntimeSelector,
      }),
    [
      diagramScopeKey,
      effectiveRuntimeSelector.deployHash,
      effectiveRuntimeSelector.kbSnapshotId,
      effectiveRuntimeSelector.knowledgeBaseId,
      effectiveRuntimeSelector.runtimeScopeId,
      effectiveRuntimeSelector.workspaceId,
    ],
  );
  const initialData = useMemo(
    () => (requestUrl ? peekKnowledgeDiagramPayload({ requestUrl }) : null),
    [requestUrl],
  );
  const shouldAutoFetch = Boolean(requestUrl && !initialData);
  const {
    data: diagramData,
    loading: diagramLoading,
    setData,
  } = useRestRequest<DiagramResponse | null>({
    enabled: Boolean(requestUrl),
    auto: shouldAutoFetch,
    initialData,
    requestKey: requestUrl,
    request: async () =>
      loadKnowledgeDiagramPayload({
        requestUrl: requestUrl as string,
        useCache: true,
      }),
  });

  useEffect(() => {
    setData(initialData);
  }, [initialData, setData]);

  const refetchDiagram = useCallback(async () => {
    if (!requestUrl) {
      setData(null);
      return null;
    }

    const payload = await loadKnowledgeDiagramPayload({
      requestUrl,
      useCache: false,
    });
    setData(payload);
    return payload;
  }, [requestUrl, setData]);

  return {
    diagramData,
    diagramLoading,
    refetchDiagram,
  };
}

export { KNOWLEDGE_DIAGRAM_QUERY_FETCH_POLICY };
