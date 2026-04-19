import { useCallback } from 'react';
import type { ClickPayload } from '@/components/diagram/Context';
import useModalAction from '@/hooks/useModalAction';
import useRelationshipModal from '@/hooks/useRelationshipModal';
import { type ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { message } from 'antd';
import { NODE_TYPE } from '@/utils/enum';
import { HISTORICAL_SNAPSHOT_READONLY_HINT } from '@/utils/runtimeSnapshot';
import buildModelingRelationshipMutationInput from './buildModelingRelationshipMutationInput';
import type {
  BuildRelationshipMutationInput,
  RunDiagramMutation,
} from './modelingWorkspaceMutationTypes';
import type { NormalizedDiagram } from './modelingWorkspaceUtils';
import useModelingWorkspaceMoreActions from './useModelingWorkspaceMoreActions';

export default function useModelingWorkspaceDiagramActions({
  diagramData,
  metadataDrawer,
  modelDrawer,
  calculatedFieldModal,
  relationshipModal,
  isModelingReadonly,
  runDiagramMutation,
  refetchDiagram,
  refetchDeployStatus,
  runtimeSelector,
}: {
  diagramData: NormalizedDiagram | null;
  metadataDrawer: { openDrawer: (value?: any) => void };
  modelDrawer: { openDrawer: (value?: any) => void };
  calculatedFieldModal: ReturnType<typeof useModalAction>;
  relationshipModal: ReturnType<typeof useRelationshipModal>;
  isModelingReadonly: boolean;
  runDiagramMutation: RunDiagramMutation;
  refetchDiagram: () => Promise<unknown>;
  refetchDeployStatus: () => Promise<unknown>;
  runtimeSelector: ClientRuntimeScopeSelector;
}) {
  const notifyModelingReadonly = useCallback(() => {
    message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
  }, []);

  const onNodeClick = useCallback(
    async (payload: ClickPayload) => {
      metadataDrawer.openDrawer(payload.data);
    },
    [metadataDrawer],
  );
  const { onMoreClick } = useModelingWorkspaceMoreActions({
    diagramData,
    calculatedFieldOpenModal: calculatedFieldModal.openModal,
    relationshipOpenModal: relationshipModal.openModal,
    modelDrawer,
    isModelingReadonly,
    notifyModelingReadonly,
    runDiagramMutation,
    refetchDiagram,
    refetchDeployStatus,
    runtimeSelector,
  });

  const onAddClick = useCallback(
    (payload: ClickPayload) => {
      if (isModelingReadonly) {
        notifyModelingReadonly();
        return;
      }
      const { targetNodeType, data } = payload;
      switch (targetNodeType) {
        case NODE_TYPE.CALCULATED_FIELD:
          if (!diagramData) {
            return;
          }
          calculatedFieldModal.openModal(undefined, {
            models: diagramData.models,
            sourceModel: data,
          });
          break;
        case NODE_TYPE.RELATION:
          relationshipModal.openModal(data);
          break;
        default:
          console.log('add', targetNodeType);
          break;
      }
    },
    [
      calculatedFieldModal,
      diagramData,
      isModelingReadonly,
      notifyModelingReadonly,
      relationshipModal,
    ],
  );

  return {
    notifyModelingReadonly,
    onNodeClick,
    onMoreClick,
    onAddClick,
    buildRelationshipMutationInput:
      buildModelingRelationshipMutationInput as BuildRelationshipMutationInput,
  };
}
