import { useEffect, useMemo } from 'react';
import { Modal, Form, Input, Select } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { GRANULARITY, COLUMN_TYPE } from '@/utils/enum';
import { FieldValue } from '@/components/selectors/modelFieldSelector/FieldSelect';
import ModelFieldSelector from '@/components/selectors/modelFieldSelector';
import { modelFieldSelectorValidator } from '@/utils/validator';
import useModelFieldOptions, {
  ModelFieldResposeData,
} from '@/hooks/useModelFieldOptions';
import { ERROR_TEXTS } from '@/utils/error';
import Link from 'next/link';

export type DimensionFieldValue = {
  [key: string]: any;
  name: string;
  modelFields?: FieldValue[];
};

type Props = ModalAction<DimensionFieldValue> & {
  model: string;
  loading?: boolean;

  // The transientData is used to get the model fields which are not created in DB yet.
  transientData?: ModelFieldResposeData[];
};

const granularityOptions = Object.values(GRANULARITY).map((value) => ({
  label: value,
  value,
}));

export default function AddDimensionFieldModal(props: Props) {
  const {
    model,
    transientData,
    visible,
    loading,
    onSubmit,
    onClose,
    defaultValue,
  } = props;
  const [form] = Form.useForm();

  const modelFields: FieldValue[] = Form.useWatch('modelFields', form);

  const modelFieldOptions = useModelFieldOptions(transientData);

  const isGranularityShow = useMemo(() => {
    const selectedField = modelFields
      ? modelFields[modelFields.length - 1]
      : null;
    return [COLUMN_TYPE.DATE, COLUMN_TYPE.TIMESTAMP].includes(
      selectedField?.type as COLUMN_TYPE
    );
  }, [modelFields]);

  useEffect(() => {
    if (!visible) return;
    form.setFieldsValue(defaultValue || {});
  }, [form, defaultValue, visible]);

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
      title="Add dimension"
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
      <div className="mb-4">
        Morem ipsum dolor sit amet, consectetur adipiscing elit. Nunc vulputate
        libero et velit interdum, ac aliquet odio mattis.{' '}
        <Link href="" target="_blank" rel="noopener noreferrer">
          Learn more
        </Link>
      </div>

      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label="Dimension name"
          name="name"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.ADD_DIMENSION_FIELD.FIELD_NAME.REQUIRED,
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="modelFields"
          rules={[
            {
              validator: modelFieldSelectorValidator(
                ERROR_TEXTS.ADD_DIMENSION_FIELD.MODEL_FIELD
              ),
            },
          ]}
        >
          <ModelFieldSelector model={model} options={modelFieldOptions} />
        </Form.Item>
        {isGranularityShow && (
          <Form.Item
            label="Granularity"
            name="granularity"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.ADD_DIMENSION_FIELD.GRANULARITY.REQUIRED,
              },
            ]}
          >
            <Select
              options={granularityOptions}
              placeholder="Select granularity"
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
