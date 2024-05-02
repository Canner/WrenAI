import { useCallback, useEffect, useMemo } from 'react';
import { Modal, Form, Input, Typography, Button } from 'antd';
import LinkOutlined from '@ant-design/icons/LinkOutlined';
import { omit } from 'lodash';
import { ERROR_TEXTS } from '@/utils/error';
import { DiagramModel } from '@/utils/data/type';
import { ModalAction } from '@/hooks/useModalAction';
import { lineageSelectorValidator } from '@/utils/validator';
import { FieldValue } from '@/components/selectors/lineageSelector/FieldSelect';
import useExpressionFieldOptions from '@/hooks/useExpressionFieldOptions';
import LineageSelector, {
  getLineageOptions,
} from '@/components/selectors/lineageSelector';
import DescriptiveSelector from '@/components/selectors/DescriptiveSelector';

export type CalculatedFieldValue = {
  [key: string]: any;
  name: string;
  expression: string;
  lineage: FieldValue[];

  payload: {
    models: DiagramModel[];
    sourceModel: DiagramModel;
  };
};

type Props = ModalAction<CalculatedFieldValue> & {
  loading?: boolean;
};

export default function AddCalculatedFieldModal(props: Props) {
  const { visible, loading, onSubmit, onClose, defaultValue } = props;

  const [form] = Form.useForm();
  const lineage = Form.useWatch('lineage', form);

  const expressionOptions = useExpressionFieldOptions();

  const models = useMemo(() => defaultValue?.payload?.models, [defaultValue]);
  const sourceModel = useMemo(
    () => defaultValue?.payload?.sourceModel,
    [defaultValue],
  );

  useEffect(() => {
    if (!visible) return;
    form.setFieldsValue(omit(defaultValue || {}, ['payload']));
  }, [form, defaultValue, visible]);

  const fetchOptions = useCallback(
    async (value) => {
      const selectedModel = models.find(
        (model) => model.referenceName === value.referenceName,
      );
      // use current model options when initial
      return getLineageOptions(selectedModel, lineage);
    },
    [models, lineage],
  );

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        await onSubmit({
          ...values,
          sourceModel: {
            modelId: sourceModel.modelId,
            referenceName: sourceModel.referenceName,
          },
        });
        onClose();
      })
      .catch(console.error);
  };

  return (
    <Modal
      title="Add calculated field"
      width={750}
      visible={visible}
      onCancel={onClose}
      confirmLoading={loading}
      maskClosable={false}
      destroyOnClose
      afterClose={() => form.resetFields()}
      footer={
        <div className="d-flex justify-space-between align-center">
          <div className="text-sm ml-2">
            <LinkOutlined className="gray-6 mr-2" />
            <Typography.Link
              type="secondary"
              href=""
              target="_blank"
              rel="noopener noreferrer"
            >
              How to set primary key in a model.
            </Typography.Link>
          </div>
          <div>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" onClick={submit} loading={loading}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label="Name"
          name="name"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.CALCULATED_FIELD.NAME.REQUIRED,
            },
          ]}
        >
          <Input />
        </Form.Item>

        <Form.Item
          label="Select an expression"
          name="expression"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.CALCULATED_FIELD.EXPRESSION.REQUIRED,
            },
          ]}
        >
          <DescriptiveSelector
            placeholder="Select an expression"
            options={expressionOptions}
            descriptiveContentRender={(content) => {
              return (
                <>
                  <div className="mb-1">{content?.description || '-'}</div>
                  {content?.expression && (
                    <Typography.Text className="mb-1" code>
                      {content.expression}
                    </Typography.Text>
                  )}
                </>
              );
            }}
          />
        </Form.Item>
        <div className="py-1" />
        <Form.Item
          name="lineage"
          rules={[
            {
              validator: lineageSelectorValidator(
                ERROR_TEXTS.CALCULATED_FIELD.LINEAGE,
              ),
            },
          ]}
        >
          <LineageSelector
            sourceModel={sourceModel}
            onFetchOptions={fetchOptions}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
