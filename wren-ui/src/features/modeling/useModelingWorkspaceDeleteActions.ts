import { useCallback } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { NODE_TYPE } from '@/utils/enum';
import { deleteViewById } from '@/utils/viewRest';
import {
  deleteCalculatedField,
  deleteModel,
  deleteRelationship,
} from '@/utils/modelingRest';
import type { RunDiagramMutation } from './modelingWorkspaceMutationTypes';

const resolveNodeNumericId = (
  data: Record<string, unknown>,
  key: 'modelId' | 'columnId' | 'relationId' | 'viewId',
) => {
  if (!(key in data) || data[key] === undefined) {
    return null;
  }
  const numericId = Number(data[key]);
  return Number.isFinite(numericId) ? numericId : null;
};

export default function useModelingWorkspaceDeleteActions({
  runDiagramMutation,
  refetchDiagram,
  refetchDeployStatus,
  runtimeSelector,
}: {
  runDiagramMutation: RunDiagramMutation;
  refetchDiagram: () => Promise<unknown>;
  refetchDeployStatus: () => Promise<unknown>;
  runtimeSelector: ClientRuntimeScopeSelector;
}) {
  const handleDeleteView = useCallback(
    async (viewId: number) => {
      try {
        await deleteViewById(runtimeSelector, viewId);
        await refetchDiagram();
        await refetchDeployStatus();
        message.success('已成功删除视图。');
      } catch (error) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '删除视图失败，请稍后重试',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      }
    },
    [refetchDeployStatus, refetchDiagram, runtimeSelector],
  );

  const handleDeleteNode = useCallback(
    async (nodeType: string, rawData: unknown) => {
      const data =
        rawData && typeof rawData === 'object'
          ? (rawData as Record<string, unknown>)
          : null;
      if (!data) {
        return;
      }

      switch (nodeType) {
        case NODE_TYPE.MODEL: {
          const modelId = resolveNodeNumericId(data, 'modelId');
          if (modelId == null) {
            return;
          }
          await runDiagramMutation(
            () => undefined,
            async () => {
              await deleteModel(runtimeSelector, modelId);
              message.success('已成功删除模型。');
            },
          );
          break;
        }
        case NODE_TYPE.CALCULATED_FIELD: {
          const columnId = resolveNodeNumericId(data, 'columnId');
          if (columnId == null) {
            return;
          }
          await runDiagramMutation(
            () => undefined,
            async () => {
              await deleteCalculatedField(runtimeSelector, columnId);
              message.success('已成功删除计算字段。');
            },
          );
          break;
        }
        case NODE_TYPE.RELATION: {
          const relationId = resolveNodeNumericId(data, 'relationId');
          if (relationId == null) {
            return;
          }
          await runDiagramMutation(
            () => undefined,
            async () => {
              await deleteRelationship(runtimeSelector, relationId);
              message.success('已成功删除关系。');
            },
          );
          break;
        }
        case NODE_TYPE.VIEW: {
          const viewId = resolveNodeNumericId(data, 'viewId');
          if (viewId == null) {
            return;
          }
          await handleDeleteView(viewId);
          break;
        }
        default:
          console.log(data);
          break;
      }
    },
    [handleDeleteView, runDiagramMutation, runtimeSelector],
  );

  return {
    handleDeleteNode,
  };
}
