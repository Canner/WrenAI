import { useState } from 'react';
import type { CreateCalculatedFieldInput } from '@/types/calculatedField';
import type {
  CreateModelInput,
  UpdateCalculatedFieldInput,
  UpdateModelInput,
} from '@/types/modeling';
import {
  createCalculatedField,
  createModel,
  updateCalculatedField,
  updateModel,
} from '@/utils/modelingRest';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type { RunDiagramMutation } from './modelingWorkspaceMutationTypes';

export default function useModelingEntityMutationHandlers({
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
  const [calculatedFieldLoading, setCalculatedFieldLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);

  const onModelSubmit = async (
    values:
      | { id: number; data: UpdateModelInput }
      | { id?: undefined; data: CreateModelInput },
  ) => {
    if (isModelingReadonly) {
      notifyModelingReadonly();
      return;
    }
    if (values.id != null) {
      await runDiagramMutation(setModelLoading, async () => {
        await updateModel(runtimeSelector, values.id, values.data);
      });
    } else {
      await runDiagramMutation(setModelLoading, async () => {
        await createModel(runtimeSelector, values.data);
      });
    }
  };

  const onCalculatedFieldSubmit = async (
    values:
      | { id: number; data: UpdateCalculatedFieldInput }
      | { id?: undefined; data: CreateCalculatedFieldInput },
  ) => {
    if (isModelingReadonly) {
      notifyModelingReadonly();
      return;
    }
    if (values.id != null) {
      await runDiagramMutation(setCalculatedFieldLoading, async () => {
        await updateCalculatedField(runtimeSelector, values.id, values.data);
      });
    } else {
      await runDiagramMutation(setCalculatedFieldLoading, async () => {
        await createCalculatedField(runtimeSelector, values.data);
      });
    }
  };

  return {
    calculatedFieldLoading,
    modelLoading,
    onModelSubmit,
    onCalculatedFieldSubmit,
  };
}
