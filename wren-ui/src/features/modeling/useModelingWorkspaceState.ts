import { useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
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

export const runInitialModelingWorkspaceLoad = async ({
  diagramRef,
  refetchDiagram,
}: {
  diagramRef: RefObject<DiagramRefHandle | null>;
  refetchDiagram: () => Promise<unknown>;
}) => {
  const nextDiagram = await refetchDiagram();
  diagramRef.current?.fitView();
  return nextDiagram;
};

export const runModelingWorkspaceRefresh = async ({
  diagramRef,
  fitView = false,
  refetchDeployStatus,
  refetchDiagram,
}: {
  diagramRef: RefObject<DiagramRefHandle | null>;
  fitView?: boolean;
  refetchDeployStatus: () => Promise<unknown>;
  refetchDiagram: () => Promise<unknown>;
}) => {
  const [nextDiagram] = await Promise.all([
    refetchDiagram(),
    refetchDeployStatus(),
  ]);
  if (fitView) {
    diagramRef.current?.fitView();
  }
  return nextDiagram;
};

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
  const { refetch: refetchDeployStatus } = deployStatusQueryResult;
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
    async ({ fitView = false }: { fitView?: boolean } = {}) =>
      runModelingWorkspaceRefresh({
        diagramRef,
        fitView,
        refetchDeployStatus,
        refetchDiagram,
      }),
    [diagramRef, refetchDeployStatus, refetchDiagram],
  );

  useEffect(() => {
    if (!runtimeScopePage.hasRuntimeScope) {
      setDiagramPayload(null);
      setDiagramLoading(false);
      return;
    }

    void runInitialModelingWorkspaceLoad({
      diagramRef,
      refetchDiagram,
    }).catch((error) => {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载图谱失败，请稍后重试',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    });
  }, [refetchDiagram, runtimeScopePage.hasRuntimeScope]);

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
