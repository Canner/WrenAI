import { useEffect } from 'react';
import { isEmpty } from 'lodash';
import { Modal, Form, Input, Select, Row, Col } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { ERROR_TEXTS } from '@/utils/error';
import CombineFieldSelector from '@/components/selectors/CombineFieldSelector';
import { JOIN_TYPE } from '@/utils/enum';
import { RelationData, getJoinTypeText } from '@/utils/data';
import useCombineFieldOptions from '@/hooks/useCombineFieldOptions';
import { RelationsDataType } from '@/components/table/ModelRelationSelectionTable';

export type RelationFieldValue = { [key: string]: any } & Pick<
  RelationData,
  'name' | 'joinType' | 'fromField' | 'toField' | 'properties'
>;

type Props = ModalAction<RelationFieldValue, RelationsDataType> & {
  model: string;
  loading?: boolean;
  allowSetDescription?: boolean;
};

export default function RelationModal(props: Props) {
  const {
    allowSetDescription = true,
    defaultValue,
    loading,
    model,
    onClose,
    onSubmit,
    visible,
  } = props;
  const [form] = Form.useForm();

  useEffect(() => {
    if (!visible) return;
    form.setFieldsValue(defaultValue || {});
  }, [form, defaultValue, visible]);

  const relationTypeOptions = Object.keys(JOIN_TYPE).map((key) => ({
    label: getJoinTypeText(key),
    value: JOIN_TYPE[key],
  }));

  const fromCombineField = useCombineFieldOptions({ model });
  const toCombineField = useCombineFieldOptions({
    model: defaultValue?.toField.model,
    excludeModels: [model],
  });

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
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label="Name"
          name="name"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.ADD_RELATION.NAME.REQUIRED,
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="From field"
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
              label="To field"
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
                modelOptions={toCombineField.modelOptions}
                fieldOptions={toCombineField.fieldOptions}
              />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          label="Relation type"
          name="joinType"
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
        {allowSetDescription && (
          <Form.Item label="Description" name={['properties', 'description']}>
            <Input.TextArea showCount maxLength={300} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
