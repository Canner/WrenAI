import { useCallback } from 'react';
import { message } from 'antd';
import type { ClickPayload } from '@/components/diagram/Context';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { MORE_ACTION, NODE_TYPE } from '@/utils/enum';
import { editCalculatedField } from '@/utils/modelingHelper';
import type { RunDiagramMutation } from './modelingWorkspaceMutationTypes';
import type { NormalizedDiagram } from './modelingWorkspaceUtils';
import useModelingWorkspaceDeleteActions from './useModelingWorkspaceDeleteActions';

export default function useModelingWorkspaceMoreActions({
  diagramData,
  calculatedFieldOpenModal,
  relationshipOpenModal,
  modelDrawer,
  isModelingReadonly,
  notifyModelingReadonly,
  runDiagramMutation,
  refetchDiagram,
  refetchDeployStatus,
  runtimeSelector,
}: {
  diagramData: NormalizedDiagram | null;
  calculatedFieldOpenModal: (value?: any, extra?: any) => void;
  relationshipOpenModal: (value?: any) => void;
  modelDrawer: { openDrawer: (value?: any) => void };
  isModelingReadonly: boolean;
  notifyModelingReadonly: () => void;
  runDiagramMutation: RunDiagramMutation;
  refetchDiagram: () => Promise<unknown>;
  refetchDeployStatus: () => Promise<unknown>;
  runtimeSelector: ClientRuntimeScopeSelector;
}) {
  const { handleDeleteNode } = useModelingWorkspaceDeleteActions({
    runDiagramMutation,
    refetchDiagram,
    refetchDeployStatus,
    runtimeSelector,
  });

  const onMoreClick = useCallback(
    (payload: ClickPayload) => {
      if (!diagramData) {
        return;
      }
      const { type, data } = payload;
      const { nodeType } = data;
      if (isModelingReadonly) {
        notifyModelingReadonly();
        return;
      }
      const action: Partial<Record<MORE_ACTION, () => void | Promise<void>>> = {
        [MORE_ACTION.UPDATE_COLUMNS]: () => {
          switch (nodeType) {
            case NODE_TYPE.MODEL:
              modelDrawer.openDrawer(data);
              break;
            default:
              console.log(data);
              break;
          }
        },
        [MORE_ACTION.EDIT]: () => {
          switch (nodeType) {
            case NODE_TYPE.CALCULATED_FIELD:
              editCalculatedField(
                { ...payload, diagramData },
                calculatedFieldOpenModal,
              );
              break;
            case NODE_TYPE.RELATION:
              relationshipOpenModal(data);
              break;
            default:
              console.log(data);
              break;
          }
        },
        [MORE_ACTION.DELETE]: () => handleDeleteNode(nodeType, data),
      };
      const handler = action[type as MORE_ACTION];
      if (handler) {
        void Promise.resolve(handler()).catch((error) => {
          const errorMessage = resolveAbortSafeErrorMessage(
            error,
            '建模操作失败，请稍后重试。',
          );
          if (errorMessage) {
            message.error(errorMessage);
          }
        });
      }
    },
    [
      calculatedFieldOpenModal,
      diagramData,
      handleDeleteNode,
      isModelingReadonly,
      modelDrawer,
      notifyModelingReadonly,
      relationshipOpenModal,
    ],
  );

  return {
    onMoreClick,
  };
}
