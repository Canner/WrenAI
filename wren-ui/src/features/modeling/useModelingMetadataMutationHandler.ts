import { useState } from 'react';
import { NODE_TYPE } from '@/utils/enum';
import { updateModelMetadata, updateViewMetadata } from '@/utils/modelingRest';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type {
  UpdateModelMetadataInput,
  UpdateViewMetadataInput,
} from '@/types/modeling';
import type { RunDiagramMutation } from './modelingWorkspaceMutationTypes';

export default function useModelingMetadataMutationHandler({
  isModelingReadonly,
  notifyModelingReadonly,
  runtimeSelector,
  runDiagramMutation,
}: {
  isModelingReadonly: boolean;
  notifyModelingReadonly: () => void;
  runtimeSelector: ClientRuntimeScopeSelector;
  runDiagramMutation: RunDiagramMutation;
}) {
  const [editMetadataLoading, setEditMetadataLoading] = useState(false);

  const onEditMetadataSubmit = async ({
    nodeType,
    data,
  }: {
    nodeType: string;
    data: UpdateModelMetadataInput &
      UpdateViewMetadataInput & {
        modelId?: number | string | null;
        viewId?: number | string | null;
      };
  }) => {
    if (isModelingReadonly) {
      notifyModelingReadonly();
      return;
    }
    const { modelId, viewId, ...metadata } = data;
    switch (nodeType) {
      case NODE_TYPE.MODEL:
        await runDiagramMutation(setEditMetadataLoading, async () => {
          await updateModelMetadata(runtimeSelector, Number(modelId), metadata);
        });
        break;
      case NODE_TYPE.VIEW:
        await runDiagramMutation(setEditMetadataLoading, async () => {
          await updateViewMetadata(runtimeSelector, Number(viewId), metadata);
        });
        break;
      default:
        console.log('onSubmit', nodeType, data);
        break;
    }
  };

  return {
    editMetadataLoading,
    onEditMetadataSubmit,
  };
}
