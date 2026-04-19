import { useState } from 'react';
import type { RelationFormValues } from '@/components/modals/RelationModal';
import { createRelationship, updateRelationship } from '@/utils/modelingRest';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type {
  BuildRelationshipMutationInput,
  RunDiagramMutation,
} from './modelingWorkspaceMutationTypes';

export default function useModelingRelationshipMutationHandler({
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
  const [relationshipLoading, setRelationshipLoading] = useState(false);

  const onRelationshipSubmit = async (
    values: RelationFormValues & { relationId?: number },
  ) => {
    if (isModelingReadonly) {
      notifyModelingReadonly();
      return;
    }
    const relationshipMutation = buildRelationshipMutationInput(values);
    if (relationshipMutation.relationId != null) {
      await runDiagramMutation(setRelationshipLoading, async () => {
        await updateRelationship(
          runtimeSelector,
          relationshipMutation.relationId,
          relationshipMutation.payload,
        );
      });
    } else {
      await runDiagramMutation(setRelationshipLoading, async () => {
        await createRelationship(runtimeSelector, relationshipMutation.payload);
      });
    }
  };

  return {
    relationshipLoading,
    onRelationshipSubmit,
  };
}
