import { useEffect } from 'react';
import { isEmpty } from 'lodash';
import { Modal, Form, Select } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { ERROR_TEXTS } from '@/utils/error';
import CombineFieldSelector from '@/components/selectors/CombineFieldSelector';
import { JOIN_TYPE, FORM_MODE, convertIdentifierToObject } from '@/utils/enum';
import { getJoinTypeText } from '@/utils/data';
import {
  createRelationshipFromFieldValidator,
  createRelationshipToFieldValidator,
} from '@/utils/validator';
import useCombineFieldOptions, {
  convertDefaultValueToIdentifier,
} from '@/hooks/useCombineFieldOptions';
import { RelationsDataType } from '@/components/table/ModelRelationSelectionTable';
import { SelectedRecommendRelations } from '@/components/pages/setup/DefineRelations';

export const FormFieldKey = {
  FROM_FIELD: 'fromField',
  TO_FIELD: 'toField',
  TYPE: 'type',
};

export interface RelationFormValues {
  fromField: { model: string; field: string };
  toField: { model: string; field: string };
  type?: string;
}

export type RelationFieldValue = Pick<
  RelationsDataType,
  'type' | 'fromField' | 'toField'
>;

type Props = ModalAction<RelationFieldValue, RelationFormValues> & {
  model: string;
  loading?: boolean;
  relations: SelectedRecommendRelations;
  isRecommendMode?: boolean;
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
    isRecommendMode,
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
              validator: createRelationshipFromFieldValidator(
                isUpdateMode || isRecommendMode,
                relations,
                getFieldValue,
              ),
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
              validator: createRelationshipToFieldValidator(
                isUpdateMode || isRecommendMode,
                relations,
                getFieldValue,
              ),
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
            data-testid="relationship-form__type-select"
            options={relationTypeOptions}
            placeholder="Select a relationship type"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
