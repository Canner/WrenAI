import { useEffect, useMemo } from 'react';
import { Modal, Form, Input, Select } from 'antd';
import { COLUMN_TYPE, TIME_UNIT } from '@/utils/enum';
import { FieldValue } from '@/components/selectors/modelFieldSelector/FieldSelect';
import ModelFieldSelector from '@/components/selectors/modelFieldSelector';
import { modelFieldSelectorValidator } from '@/utils/validator';
import useModelFieldOptions, {
  ModelFieldResposeData,
} from '@/hooks/useModelFieldOptions';
import { ERROR_TEXTS } from '@/utils/error';
import Link from 'next/link';

export type WindowFieldValue = {
  [key: string]: any;
  name: string;
  modelFields?: FieldValue[];
};

interface Props {
  model: string;
  visible: boolean;
  onSubmit: (values: any) => Promise<void>;
  onClose: () => void;
  loading?: boolean;
  defaultValue?: WindowFieldValue;

  // The transientData is used to get the model fields which are not created in DB yet.
  transientData?: ModelFieldResposeData[];
}

const timeUnitOptions = Object.values(TIME_UNIT).map((value) => ({
  label: value,
  value,
}));

export default function AddWindowFieldModal(props: Props) {
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

  useEffect(() => {
    if (!visible) return;
    form.setFieldsValue(defaultValue || {});
  }, [form, defaultValue, visible]);

  const modelFieldOptions = useModelFieldOptions(transientData);

  const filteredModelFieldOptions = useMemo(() => {
    return (modelFieldOptions || []).filter((option) => {
      return (
        !!option.options ||
        [COLUMN_TYPE.DATE, COLUMN_TYPE.TIMESTAMP].includes(
          option.value?.type as COLUMN_TYPE
        )
      );
    });
  }, [modelFieldOptions]);

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
      title="Add window"
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
          label="Window name"
          name="name"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.ADD_WINDOW_FIELD.FIELD_NAME.REQUIRED,
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
          <ModelFieldSelector
            model={model}
            options={filteredModelFieldOptions}
          />
        </Form.Item>
        <Form.Item
          label="Time unit"
          name="timeUnit"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.ADD_WINDOW_FIELD.TIME_UNIT.REQUIRED,
            },
          ]}
        >
          <Select options={timeUnitOptions} placeholder="Select time unit" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
