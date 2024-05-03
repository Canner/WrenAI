import { useMemo, useState } from 'react';
import { NODE_TYPE } from '@/utils/enum';
import { Diagram } from '@/utils/data';
import useModalAction from '@/hooks/useModalAction';

export default function useRelationshipModal(diagramData: Diagram | null) {
  const relationshipModal = useModalAction();

  const [selectedModelReferenceName, setSelectedModelReferenceName] =
    useState<string>(null);

  // Parse out the relationships data under all models
  const relationships = useMemo(
    () =>
      (diagramData?.models || []).reduce((acc, currentValue) => {
        const { referenceName, relationFields } = currentValue;
        const newRelationship = relationFields.map((relationship) => {
          return {
            id: relationship.relationId,
            fromField: {
              modelId: String(relationship.fromModelId),
              modelName: relationship.fromModelName,
              fieldId: String(relationship.fromColumnId),
              fieldName: relationship.fromColumnName,
            },
            toField: {
              modelId: String(relationship.toModelId),
              modelName: relationship.toModelName,
              fieldId: String(relationship.toColumnId),
              fieldName: relationship.toColumnName,
            },
            type: relationship.type,
          };
        });

        acc[referenceName] = newRelationship;
        return acc;
      }, {}),
    [diagramData],
  );

  const onClose = () => {
    setSelectedModelReferenceName(null);
    relationshipModal.closeModal();
  };

  const openModal = (data) => {
    // update mode
    if (data.nodeType === NODE_TYPE.RELATION) {
      setSelectedModelReferenceName(data.fromModelName);
      relationshipModal.openModal({
        relationId: data.relationId,
        fromField: {
          modelId: String(data.fromModelId),
          modelName: data.fromModelName,
          fieldId: String(data.fromColumnId),
          fieldName: data.fromColumnName,
        },
        toField: {
          modelId: String(data.toModelId),
          modelName: data.toModelName,
          fieldId: String(data.toColumnId),
          fieldName: data.toColumnName,
        },
        type: data.type,
      });
      return;
    }

    // create mode
    setSelectedModelReferenceName(data.referenceName);
    relationshipModal.openModal();
  };

  return {
    onClose,
    openModal,
    state: {
      ...relationshipModal.state,
      model: selectedModelReferenceName,
      relations: relationships,
    },
  };
}
