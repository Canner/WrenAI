import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type {
  BuildRelationshipMutationInput,
  RunDiagramMutation,
} from './modelingWorkspaceMutationTypes';
import useModelingEntityMutationHandlers from './useModelingEntityMutationHandlers';
import useModelingMetadataMutationHandler from './useModelingMetadataMutationHandler';
import useModelingRelationshipMutationHandler from './useModelingRelationshipMutationHandler';

export default function useModelingWorkspaceMutationHandlers({
  isModelingReadonly,
  notifyModelingReadonly,
  runtimeSelector,
  runDiagramMutation,
  buildRelationshipMutationInput,
}: {
  isModelingReadonly: boolean;
  notifyModelingReadonly: () => void;
  runtimeSelector: ClientRuntimeScopeSelector;
  runDiagramMutation: RunDiagramMutation;
  buildRelationshipMutationInput: BuildRelationshipMutationInput;
}) {
  const metadataMutations = useModelingMetadataMutationHandler({
    isModelingReadonly,
    notifyModelingReadonly,
    runtimeSelector,
    runDiagramMutation,
  });
  const entityMutations = useModelingEntityMutationHandlers({
    isModelingReadonly,
    notifyModelingReadonly,
    runtimeSelector,
    runDiagramMutation,
  });
  const relationshipMutations = useModelingRelationshipMutationHandler({
    isModelingReadonly,
    notifyModelingReadonly,
    runtimeSelector,
    runDiagramMutation,
    buildRelationshipMutationInput,
  });

  return {
    ...metadataMutations,
    ...entityMutations,
    ...relationshipMutations,
  };
}
