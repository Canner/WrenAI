import { useEffect } from 'react';
import { Modal, Form, Input } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { ERROR_TEXTS } from '@/utils/error';

interface MetadataValue {
  displayName: string;
  description?: string;
}

type Props = ModalAction<MetadataValue> & {
  loading?: boolean;
};

export default function UpdateMetadataModal(props: Props) {
  const { visible, loading, onSubmit, onClose, defaultValue } = props;
  const [form] = Form.useForm();

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
      title="Update field metadata"
      width={520}
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
          name="displayName"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.UPDATE_METADATA.NAME.REQUIRED,
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item label="Description" name="description">
          <Input.TextArea showCount maxLength={300} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
