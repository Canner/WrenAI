import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import useDeployStatusRest from '@/hooks/useDeployStatusRest';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import {
  buildKnowledgeDiagramUrl,
  loadKnowledgeDiagramPayload,
} from '@/utils/knowledgeDiagramRest';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import {
  HISTORICAL_SNAPSHOT_READONLY_HINT,
  isHistoricalSnapshotReadonly,
} from '@/utils/runtimeSnapshot';
import { type Diagram as RuntimeDiagram } from '@/utils/data';
import type { DiagramRefHandle } from './modelingWorkspaceUtils';
import {
  normalizeRuntimeDiagram,
  readModelingWorkspaceQueryParams,
} from './modelingWorkspaceUtils';

export default function useModelingWorkspaceState() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const searchParams = useSearchParams();
  const diagramRef = useRef<DiagramRefHandle | null>(null);
  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;
  const isModelingReadonly =
    runtimeSelectorState?.currentKnowledgeBase?.kind === 'system_sample' ||
    isHistoricalSnapshotReadonly({
      selectorHasRuntime: Boolean(
        runtimeScopeNavigation.selector.deployHash ||
          runtimeScopeNavigation.selector.kbSnapshotId ||
          runtimeScopeNavigation.selector.runtimeScopeId,
      ),
      currentKbSnapshotId: runtimeSelectorState?.currentKbSnapshot?.id,
      defaultKbSnapshotId:
        runtimeSelectorState?.currentKnowledgeBase?.defaultKbSnapshotId,
    });

  const deployStatusQueryResult = useDeployStatusRest();
  const [diagramPayload, setDiagramPayload] = useState<{
    diagram: RuntimeDiagram;
  } | null>(null);
  const [_diagramLoading, setDiagramLoading] = useState(false);
  const diagramRequestUrl = useMemo(
    () =>
      runtimeScopePage.hasRuntimeScope
        ? buildKnowledgeDiagramUrl(runtimeScopeNavigation.selector)
        : null,
    [runtimeScopeNavigation.selector, runtimeScopePage.hasRuntimeScope],
  );

  const refetchDiagram = useCallback(async () => {
    if (!diagramRequestUrl) {
      setDiagramPayload(null);
      setDiagramLoading(false);
      return null;
    }

    setDiagramLoading(true);
    try {
      const payload = await loadKnowledgeDiagramPayload({
        requestUrl: diagramRequestUrl,
        useCache: false,
      });
      setDiagramPayload(payload);
      return payload;
    } finally {
      setDiagramLoading(false);
    }
  }, [diagramRequestUrl]);

  const refreshModelingData = useCallback(
    async ({ fitView = false }: { fitView?: boolean } = {}) => {
      const [nextDiagram] = await Promise.all([
        refetchDiagram(),
        deployStatusQueryResult.refetch(),
      ]);
      if (fitView) {
        diagramRef.current?.fitView();
      }
      return nextDiagram;
    },
    [deployStatusQueryResult, refetchDiagram],
  );

  useEffect(() => {
    if (!runtimeScopePage.hasRuntimeScope) {
      setDiagramPayload(null);
      setDiagramLoading(false);
      return;
    }

    void refreshModelingData({ fitView: true }).catch((error) => {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载图谱失败，请稍后重试',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    });
  }, [refreshModelingData, runtimeScopePage.hasRuntimeScope]);

  const diagramData = useMemo(
    () => normalizeRuntimeDiagram(diagramPayload?.diagram),
    [diagramPayload],
  );
  const queryParams = useMemo(
    () => readModelingWorkspaceQueryParams(searchParams),
    [searchParams],
  );
  const loading = runtimeScopePage.guarding || diagramData === null;

  return {
    runtimeScopeNavigation,
    runtimeScopePage,
    deployStatusQueryResult,
    diagramRef,
    diagramData,
    queryParams,
    refetchDiagram,
    refreshModelingData,
    isModelingReadonly,
    loading,
    readonlyHint: HISTORICAL_SNAPSHOT_READONLY_HINT,
  };
}
