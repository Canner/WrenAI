import type { RelationFormValues } from '@/components/modals/RelationModal';
import { convertFormValuesToIdentifier } from '@/hooks/useCombineFieldOptions';
import type { BuildRelationshipMutationInput } from './modelingWorkspaceMutationTypes';

const buildModelingRelationshipMutationInput: BuildRelationshipMutationInput = (
  values: RelationFormValues & { relationId?: number },
) => {
  const relation = convertFormValuesToIdentifier(values);
  if (values.relationId != null) {
    return {
      relationId: values.relationId,
      payload: { type: relation.type },
    };
  }
  return {
    relationId: null,
    payload: {
      fromModelId: Number(relation.fromField.modelId),
      fromColumnId: Number(relation.fromField.fieldId),
      toModelId: Number(relation.toField.modelId),
      toColumnId: Number(relation.toField.fieldId),
      type: relation.type,
    },
  };
};

export default buildModelingRelationshipMutationInput;
