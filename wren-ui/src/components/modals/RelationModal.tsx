import { useEffect } from 'react';
import { isEmpty } from 'lodash';
import { Modal, Form, Select } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { ERROR_TEXTS } from '@/utils/error';
import CombineFieldSelector from '@/components/selectors/CombineFieldSelector';
import { JOIN_TYPE, FORM_MODE, convertIdentifierToObject } from '@/utils/enum';
import { getJoinTypeText } from '@/utils/data';
import useCombineFieldOptions, {
  convertDefaultValueToIdentifier,
  convertFormValuesToIdentifier,
} from '@/hooks/useCombineFieldOptions';
import { RelationsDataType } from '@/components/table/ModelRelationSelectionTable';
import { SelectedRecommendRelations } from '@/components/pages/setup/DefineRelations';

const FormFieldKey = {
  FROM_FIELD: 'fromField',
  TO_FIELD: 'toField',
  TYPE: 'type',
};

export interface RelationFormValues {
  fromField: { model: string; field: string };
  toField: { model: string; field: string };
  type: string;
}

export type RelationFieldValue = Pick<
  RelationsDataType,
  'type' | 'fromField' | 'toField'
>;

type Props = ModalAction<RelationFieldValue, RelationFormValues> & {
  model: string;
  loading?: boolean;
  relations: SelectedRecommendRelations;
};

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
  existingRelationships: RelationsDataType[],
  formValues: RelationsDataType,
) => {
  return existingRelationships.find(
    (relationship) =>
      (relationship.fromField.modelId === formValues.fromField.modelId &&
        relationship.fromField.fieldId === formValues.fromField.fieldId &&
        relationship.toField.modelId === formValues.toField.modelId &&
        relationship.toField.fieldId === formValues.toField.fieldId) ||
      (relationship.fromField.modelId === formValues.toField.modelId &&
        relationship.fromField.fieldId === formValues.toField.fieldId &&
        relationship.toField.modelId === formValues.fromField.modelId &&
        relationship.toField.fieldId === formValues.fromField.fieldId),
  );
};

export default function RelationModal(props: Props) {
  const {
    defaultValue,
    loading,
    model,
    onClose,
    onSubmit,
    relations,
    visible,
    formMode,
  } = props;
  const [form] = Form.useForm();

  // only suitable use for modeling page
  const isUpdateMode = formMode === FORM_MODE.EDIT;

  const fromCombineField = useCombineFieldOptions({ model });
  const modelValue = fromCombineField.modelOptions.find((option) => {
    const value: any = convertIdentifierToObject(option.value);
    return value.referenceName === model;
  })?.value;

  const toFieldModel = defaultValue?.toField.modelName;
  const toCombineField = useCombineFieldOptions({
    model: toFieldModel,
    excludeModels: [model],
  });

  useEffect(() => {
    if (!visible || isEmpty(defaultValue)) return;

    const transformedValue = convertDefaultValueToIdentifier(defaultValue);
    form.setFieldsValue(transformedValue);

    toCombineField.onModelChange(transformedValue.toField.model);
  }, [form, defaultValue, visible]);

  const relationTypeOptions = Object.keys(JOIN_TYPE).map((key) => ({
    label: getJoinTypeText(key),
    value: JOIN_TYPE[key],
  }));

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        await onSubmit({ ...defaultValue, ...values });
        onClose();
      })
      .catch(console.error);
  };

  return (
    <Modal
      title={`${isEmpty(defaultValue) ? 'Add' : 'Update'} relationship`}
      width={750}
      visible={visible}
      okText="Submit"
      onOk={submit}
      onCancel={onClose}
      confirmLoading={loading}
      maskClosable={false}
      destroyOnClose
      afterClose={() => form.resetFields()}
      centered
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label="From"
          name={FormFieldKey.FROM_FIELD}
          required
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || !value.field) {
                  return Promise.reject(
                    ERROR_TEXTS.ADD_RELATION.FROM_FIELD.REQUIRED,
                  );
                }

                if (!isUpdateMode) {
                  const toField = getFieldValue(FormFieldKey.TO_FIELD);
                  if (toField && toField.model && toField.field) {
                    if (
                      isExistRelationship(
                        relations[model],
                        convertFormValuesToIdentifier({
                          fromField: value,
                          toField,
                          type: '',
                        }),
                      )
                    ) {
                      return Promise.reject(
                        ERROR_TEXTS.ADD_RELATION.RELATIONSHIP.EXIST,
                      );
                    }
                  }
                }

                return Promise.resolve();
              },
            }),
          ]}
        >
          <CombineFieldSelector
            modelValue={modelValue}
            modelDisabled={true}
            fieldDisabled={isUpdateMode}
            onModelChange={fromCombineField.onModelChange}
            modelOptions={fromCombineField.modelOptions}
            fieldOptions={fromCombineField.fieldOptions}
          />
        </Form.Item>
        <Form.Item
          label="To"
          name={FormFieldKey.TO_FIELD}
          required
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || !value.field) {
                  return Promise.reject(
                    ERROR_TEXTS.ADD_RELATION.TO_FIELD.REQUIRED,
                  );
                }

                if (!isUpdateMode) {
                  const fromField = getFieldValue(FormFieldKey.FROM_FIELD);
                  if (fromField && fromField.model && fromField.field) {
                    if (
                      isExistRelationship(
                        relations[model],
                        convertFormValuesToIdentifier({
                          fromField,
                          toField: value,
                          type: '',
                        }),
                      )
                    ) {
                      return Promise.reject(
                        ERROR_TEXTS.ADD_RELATION.RELATIONSHIP.EXIST,
                      );
                    }
                  }
                }

                return Promise.resolve();
              },
            }),
          ]}
        >
          <CombineFieldSelector
            onModelChange={toCombineField.onModelChange}
            modelOptions={toCombineField.modelOptions}
            fieldOptions={toCombineField.fieldOptions}
            modelDisabled={isUpdateMode}
            fieldDisabled={isUpdateMode}
          />
        </Form.Item>
        <Form.Item
          label="Type"
          name={FormFieldKey.TYPE}
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.ADD_RELATION.RELATION_TYPE.REQUIRED,
            },
          ]}
        >
          <Select
            options={relationTypeOptions}
            placeholder="Select a relationship type"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
