import { useEffect } from 'react';
import { isEmpty } from 'lodash';
import { Modal, Form, Select } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { ERROR_TEXTS } from '@/utils/error';
import CombineFieldSelector from '@/components/selectors/CombineFieldSelector';
import { JOIN_TYPE } from '@/utils/enum';
import { getJoinTypeText } from '@/utils/data';
import useCombineFieldOptions, {
  convertDefaultValueToIdentifier,
} from '@/hooks/useCombineFieldOptions';
import { RelationsDataType } from '@/components/table/ModelRelationSelectionTable';
import { SelectedRecommendRelations } from '@/components/pages/setup/DefineRelations';

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

export default function RelationModal(props: Props) {
  const {
    defaultValue,
    loading,
    model,
    onClose,
    onSubmit,
    relations,
    visible,
  } = props;
  const [form] = Form.useForm();

  const fromCombineField = useCombineFieldOptions({ model });
  const modelValue = fromCombineField.modelOptions.find(
    (m) => m.label === model,
  )?.value;

  const toFieldModel = defaultValue?.toField.modelName;
  const toCombineField = useCombineFieldOptions({
    model: toFieldModel,
    excludeModels: [model],
  });

  useEffect(() => {
    if (!visible) return;
    fromCombineField.onModelChange(model);

    if (isEmpty(defaultValue)) return;

    const transformedValue = convertDefaultValueToIdentifier(defaultValue);
    form.setFieldsValue(transformedValue);

    toCombineField.onModelChange(toFieldModel);
  }, [form, defaultValue, visible]);

  const relationTypeOptions = Object.keys(JOIN_TYPE).map((key) => ({
    label: getJoinTypeText(key),
    value: JOIN_TYPE[key],
  }));

  // check that only 1 set of relationships can be set up between models
  const toCombineModelOptions = toCombineField.modelOptions.map(
    (modelOption) => {
      const modelList = Object.entries(relations).reduce(
        (acc, [modelName, modelRelations]) => {
          if (modelName === model) {
            const toFieldModelList = modelRelations.map(
              (relation) => relation.toField.modelName,
            );

            acc = [
              ...acc,
              ...(isEmpty(defaultValue)
                ? toFieldModelList
                : toFieldModelList.filter(
                    (toFieldModel) =>
                      toFieldModel !== defaultValue.toField.modelName,
                  )),
            ];
          } else {
            const toFieldModelList = modelRelations.map(
              (relation) => relation.toField.modelName,
            );
            if (toFieldModelList.includes(model)) {
              acc = [...acc, modelName];
            }
          }

          return acc;
        },
        [],
      );

      const disabled = modelList.includes(modelOption.label);

      return {
        ...modelOption,
        disabled,
      };
    },
  );

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
          name="fromField"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.ADD_RELATION.FROM_FIELD.REQUIRED,
            },
          ]}
        >
          <CombineFieldSelector
            modelValue={modelValue}
            modelDisabled={true}
            onModelChange={fromCombineField.onModelChange}
            modelOptions={fromCombineField.modelOptions}
            fieldOptions={fromCombineField.fieldOptions}
          />
        </Form.Item>
        <Form.Item
          label="To"
          name="toField"
          required
          rules={[
            () => ({
              validator(_, value) {
                if (!value || !value.field) {
                  return Promise.reject(
                    ERROR_TEXTS.ADD_RELATION.TO_FIELD.REQUIRED,
                  );
                }

                return Promise.resolve();
              },
            }),
          ]}
        >
          <CombineFieldSelector
            onModelChange={toCombineField.onModelChange}
            modelOptions={toCombineModelOptions}
            fieldOptions={toCombineField.fieldOptions}
          />
        </Form.Item>
        <Form.Item
          label="Type"
          name="type"
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
