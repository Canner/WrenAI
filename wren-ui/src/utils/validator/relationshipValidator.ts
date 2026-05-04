import { FormInstance } from 'antd';
import { ERROR_TEXTS } from '@/utils/error';
import { RelationsDataType } from '@/components/table/ModelRelationSelectionTable';
import { SelectedRecommendRelations } from '@/components/pages/setup/DefineRelations';
import { convertFormValuesToIdentifier } from '@/hooks/useCombineFieldOptions';
import { FormFieldKey } from '@/components/modals/RelationModal';

/**
 * Check if the relationship already exists
 *
 * Consider: Assume we have an existing relationship: Customers.orderId -> Orders.orderId, One-to-Many
 * There are two cases to check:
 * 1. Same as from and to of existing relationship
 *    (E.g., add new relationship: Customers.orderId -> Orders.orderId)
 * 2. Reverse of from and to of existing relationship
 *    (E.g., add new relationship: Orders.orderId -> Customers.orderId)
 *
 * @param existingRelationships
 * @param formValues
 * @returns boolean
 */
const isExistRelationship = (
  relationships: SelectedRecommendRelations,
  formValues: RelationsDataType,
) => {
  const relationshipsByFromFieldModel =
    relationships[formValues.fromField.modelName];
  const isDuplicate = Boolean(
    relationshipsByFromFieldModel.find(
      (relationship) =>
        relationship.fromField.modelId === formValues.fromField.modelId &&
        relationship.fromField.fieldId === formValues.fromField.fieldId &&
        relationship.toField.modelId === formValues.toField.modelId &&
        relationship.toField.fieldId === formValues.toField.fieldId,
    ),
  );

  if (isDuplicate) return true;

  const relationshipsbyToFieldModel =
    relationships[formValues.toField.modelName];
  const isReverseDuplicate = Boolean(
    relationshipsbyToFieldModel.find(
      (relationship) =>
        relationship.fromField.modelId === formValues.toField.modelId &&
        relationship.fromField.fieldId === formValues.toField.fieldId &&
        relationship.toField.modelId === formValues.fromField.modelId &&
        relationship.toField.fieldId === formValues.fromField.fieldId,
    ),
  );

  return isReverseDuplicate;
};

export const createRelationshipFromFieldValidator =
  (
    skip = false,
    relationships: SelectedRecommendRelations,
    getFieldValue: FormInstance['getFieldValue'],
  ) =>
  async (_, value: any) => {
    if (!value || !value.field) {
      return Promise.reject(ERROR_TEXTS.ADD_RELATION.FROM_FIELD.REQUIRED);
    }

    if (!skip) {
      const toField = getFieldValue(FormFieldKey.TO_FIELD);
      if (toField && toField.model && toField.field) {
        if (
          isExistRelationship(
            relationships,
            convertFormValuesToIdentifier({
              fromField: value,
              toField,
            }),
          )
        ) {
          return Promise.reject(ERROR_TEXTS.ADD_RELATION.RELATIONSHIP.EXIST);
        }
      }
    }

    return Promise.resolve();
  };

export const createRelationshipToFieldValidator =
  (
    skip = false,
    relationships: SelectedRecommendRelations,
    getFieldValue: FormInstance['getFieldValue'],
  ) =>
  async (_, value: any) => {
    if (!value || !value.field) {
      return Promise.reject(ERROR_TEXTS.ADD_RELATION.TO_FIELD.REQUIRED);
    }

    if (!skip) {
      const fromField = getFieldValue(FormFieldKey.FROM_FIELD);
      if (fromField && fromField.model && fromField.field) {
        if (
          isExistRelationship(
            relationships,
            convertFormValuesToIdentifier({
              fromField,
              toField: value,
            }),
          )
        ) {
          return Promise.reject(ERROR_TEXTS.ADD_RELATION.RELATIONSHIP.EXIST);
        }
      }
    }

    return Promise.resolve();
  };
