import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiagramResponse } from '@/types/modeling';
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
  const diagramRequestIdRef = useRef(0);
  const previousDiagramScopeKeyRef = useRef<string | null>(null);
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
  const requestUrl = useMemo(() => {
    if (!diagramScopeKey) {
      return null;
    }

    return buildKnowledgeDiagramUrl(effectiveRuntimeSelector);
  }, [
    diagramScopeKey,
    effectiveRuntimeSelector.deployHash,
    effectiveRuntimeSelector.kbSnapshotId,
    effectiveRuntimeSelector.knowledgeBaseId,
    effectiveRuntimeSelector.runtimeScopeId,
    effectiveRuntimeSelector.workspaceId,
  ]);
  const [diagramData, setDiagramData] = useState<DiagramResponse | null>(
    requestUrl ? peekKnowledgeDiagramPayload({ requestUrl }) : null,
  );
  const [diagramLoading, setDiagramLoading] = useState(
    Boolean(requestUrl && !peekKnowledgeDiagramPayload({ requestUrl })),
  );

  const refetchDiagram = useCallback(async () => {
    if (!diagramScopeKey || !requestUrl) {
      diagramRequestIdRef.current += 1;
      previousDiagramScopeKeyRef.current = null;
      setDiagramData(null);
      setDiagramLoading(false);
      return null;
    }

    const cachedDiagramData = peekKnowledgeDiagramPayload({ requestUrl });
    if (cachedDiagramData) {
      previousDiagramScopeKeyRef.current = diagramScopeKey;
      setDiagramData(cachedDiagramData);
      setDiagramLoading(false);
      return cachedDiagramData;
    }

    previousDiagramScopeKeyRef.current = diagramScopeKey;

    const requestId = diagramRequestIdRef.current + 1;
    diagramRequestIdRef.current = requestId;
    setDiagramLoading(true);

    try {
      const responseData = await loadKnowledgeDiagramPayload({
        requestUrl,
        useCache: true,
      });

      if (diagramRequestIdRef.current === requestId) {
        setDiagramData(responseData);
      }

      return responseData;
    } finally {
      if (diagramRequestIdRef.current === requestId) {
        setDiagramLoading(false);
      }
    }
  }, [diagramScopeKey, requestUrl]);

  useEffect(() => {
    void refetchDiagram();
  }, [refetchDiagram]);

  return {
    diagramData,
    diagramLoading,
    refetchDiagram,
  };
}

export { KNOWLEDGE_DIAGRAM_QUERY_FETCH_POLICY };
