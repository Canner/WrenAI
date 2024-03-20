import { useEffect } from 'react';
import { isEmpty } from 'lodash';
import { Modal, Form, Select, Row, Col } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { ERROR_TEXTS } from '@/utils/error';
import CombineFieldSelector from '@/components/selectors/CombineFieldSelector';
import { JOIN_TYPE } from '@/utils/enum';
import { getJoinTypeText } from '@/utils/data';
import useCombineFieldOptions from '@/hooks/useCombineFieldOptions';
import { RelationsDataType } from '@/components/table/ModelRelationSelectionTable';
import { SelectedRecommendRelations } from '@/components/pages/setup/DefineRelations';

export type RelationFieldValue = { [key: string]: any } & Pick<
  RelationsDataType,
  'name' | 'type' | 'fromField' | 'toField' | 'properties'
>;

type Props = ModalAction<RelationFieldValue, RelationsDataType> & {
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

  const toFieldModel = defaultValue?.toField.model;
  const toCombineField = useCombineFieldOptions({
    model: toFieldModel,
    excludeModels: [model],
  });

  useEffect(() => {
    if (!visible) return;
    fromCombineField.onModelChange(model);
    form.setFieldsValue(defaultValue || {});

    if (toFieldModel) {
      toCombineField.onModelChange(toFieldModel);
    }
  }, [form, defaultValue, visible]);

  const relationTypeOptions = Object.keys(JOIN_TYPE).map((key) => ({
    label: getJoinTypeText(key),
    value: JOIN_TYPE[key],
  }));

  const toCombineModelOptions = toCombineField.modelOptions.map(
    (modelOption) => {
      const modelList = Object.entries(relations).reduce(
        (acc, [modelName, modelRelations]) => {
          // For add relation, if the Model option has been selected in the From model relations, the Model option should be disabled
          if (modelName === model) {
            acc = [
              ...acc,
              ...modelRelations.map((relation) => relation.toField.model),
            ];
          } else {
            const toFieldModelList = modelRelations.map(
              (relation) => relation.toField.model,
            );
            if (toFieldModelList.includes(model)) {
              acc = [...acc, modelName];
            }
          }
          return acc;
        },
        [],
      );

      const disabled = modelList.includes(modelOption.value);

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
      title={`${isEmpty(defaultValue) ? 'Add' : 'Update'} relation`}
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
        <Row gutter={16}>
          <Col span={12}>
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
                modelValue={model}
                modelDisabled={true}
                onModelChange={fromCombineField.onModelChange}
                modelOptions={fromCombineField.modelOptions}
                fieldOptions={fromCombineField.fieldOptions}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="To"
              name="toField"
              required
              rules={[
                {
                  required: true,
                  message: ERROR_TEXTS.ADD_RELATION.TO_FIELD.REQUIRED,
                },
              ]}
            >
              <CombineFieldSelector
                onModelChange={toCombineField.onModelChange}
                modelOptions={toCombineModelOptions}
                fieldOptions={toCombineField.fieldOptions}
              />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          label="Relation type"
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
            placeholder="Select a relation type"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
