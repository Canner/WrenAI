import { useCallback, useEffect, type Key, type RefObject } from 'react';
import * as events from '@/utils/events';
import { buildKnowledgeWorkbenchParams } from '@/utils/knowledgeWorkbench';
import { NODE_TYPE, Path } from '@/utils/enum';
import useDrawerAction from '@/hooks/useDrawerAction';
import useRelationshipModal from '@/hooks/useRelationshipModal';
import type {
  DiagramRefHandle,
  ModelingMetadataSelection,
  NormalizedDiagram,
  readModelingWorkspaceQueryParams,
} from './modelingWorkspaceUtils';

type RuntimeScopeNavigationLike = {
  replaceWorkspace: (
    path: Path,
    params?: Record<string, string | number | boolean>,
  ) => void;
};

export default function useModelingWorkspaceNavigationEffects({
  diagramData,
  queryParams,
  metadataDrawer,
  modelDrawer,
  relationshipModal,
  diagramRef,
  runtimeScopeNavigation,
}: {
  diagramData: NormalizedDiagram | null;
  queryParams: ReturnType<typeof readModelingWorkspaceQueryParams>;
  metadataDrawer: ReturnType<typeof useDrawerAction>;
  modelDrawer: ReturnType<typeof useDrawerAction>;
  relationshipModal: ReturnType<typeof useRelationshipModal>;
  diagramRef: RefObject<DiagramRefHandle | null>;
  runtimeScopeNavigation: RuntimeScopeNavigationLike;
}) {
  const clearPath = Path.Knowledge;
  const clearParams = buildKnowledgeWorkbenchParams('modeling');

  useEffect(() => {
    if (
      queryParams.openAssistant === 'relationships' ||
      queryParams.openAssistant === 'semantics'
    ) {
      runtimeScopeNavigation.replaceWorkspace(
        queryParams.openAssistant === 'relationships'
          ? Path.RecommendRelationships
          : Path.RecommendSemantics,
      );
      return;
    }
  }, [queryParams.openAssistant, runtimeScopeNavigation]);

  useEffect(() => {
    if (!diagramData) return;
    if (queryParams.modelId && queryParams.openMetadata) {
      const searchedModel = diagramData.models.find(
        (model) => model.modelId === Number(queryParams.modelId),
      );
      if (searchedModel) {
        metadataDrawer.openDrawer(searchedModel);
      }
      runtimeScopeNavigation.replaceWorkspace(clearPath, clearParams);
      return;
    }

    if (queryParams.viewId && queryParams.openMetadata) {
      const searchedView = diagramData.views.find(
        (view) => view.viewId === Number(queryParams.viewId),
      );
      if (searchedView) {
        metadataDrawer.openDrawer(searchedView);
      }
      runtimeScopeNavigation.replaceWorkspace(clearPath, clearParams);
      return;
    }

    if (queryParams.openModelDrawer) {
      modelDrawer.openDrawer();
      runtimeScopeNavigation.replaceWorkspace(clearPath, clearParams);
      return;
    }

    if (queryParams.relationId && queryParams.openRelationModal) {
      const relationId = Number(queryParams.relationId);
      const searchedRelation = diagramData.models
        .flatMap((model) => model.relationFields || [])
        .find((relation) => relation?.relationId === relationId);
      if (searchedRelation) {
        relationshipModal.openModal(searchedRelation);
      }
      runtimeScopeNavigation.replaceWorkspace(clearPath, clearParams);
      return;
    }

    if (queryParams.modelId && queryParams.openRelationModal) {
      const searchedModel = diagramData.models.find(
        (model) => model.modelId === Number(queryParams.modelId),
      );
      if (searchedModel) {
        relationshipModal.openModal(searchedModel);
      }
      runtimeScopeNavigation.replaceWorkspace(clearPath, clearParams);
    }
  }, [
    clearParams,
    diagramData,
    metadataDrawer,
    modelDrawer,
    queryParams,
    relationshipModal,
    runtimeScopeNavigation,
  ]);

  useEffect(() => {
    if (!metadataDrawer.state.visible || !diagramData) {
      return;
    }
    const selectedData = metadataDrawer.state.defaultValue as
      | ModelingMetadataSelection
      | undefined;
    if (!selectedData) {
      return;
    }
    let currentNodeData: ModelingMetadataSelection | undefined;
    switch (selectedData.nodeType) {
      case NODE_TYPE.MODEL:
        currentNodeData = diagramData.models.find(
          (model) => model.modelId === selectedData.modelId,
        );
        break;
      case NODE_TYPE.VIEW:
        currentNodeData = diagramData.views.find(
          (view) => view.viewId === selectedData.viewId,
        );
        break;
      default:
        break;
    }
    metadataDrawer.updateState(currentNodeData);
  }, [diagramData, metadataDrawer]);

  const onSelect = useCallback(
    (selectKeys: Key[]) => {
      const firstSelectedKey = selectKeys[0];
      if (!diagramRef.current || !firstSelectedKey) {
        return;
      }
      const { getNodes, fitBounds } = diagramRef.current;
      const node = getNodes().find(
        (candidate) => candidate.id === String(firstSelectedKey),
      );
      if (!node) {
        return;
      }
      fitBounds({
        ...node.position,
        width: node.width,
        height: node.height,
      });
    },
    [diagramRef],
  );

  const goToFirstModel = useCallback(() => {
    if (!diagramRef.current) {
      return;
    }
    const { getNodes } = diagramRef.current;
    const node = getNodes()[0];
    if (node?.id) {
      onSelect([node.id]);
    }
  }, [diagramRef, onSelect]);

  useEffect(() => {
    events.subscribe(events.EVENT_NAME.GO_TO_FIRST_MODEL, goToFirstModel);
    return () => {
      events.unsubscribe(events.EVENT_NAME.GO_TO_FIRST_MODEL, goToFirstModel);
    };
  }, [goToFirstModel]);

  return {
    onSelect,
  };
}
