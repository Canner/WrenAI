import { Modal, Form, Input } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { ERROR_TEXTS } from '@/utils/error';
import CodeBlock from '@/components/editor/CodeBlock';

type Props = ModalAction<{ sql: string }> & {
  loading?: boolean;
  defaultValue?: { sql: string };
};

export default function SaveAsViewModal(props: Props) {
  const { visible, loading, onSubmit, onClose, defaultValue } = props;
  const [form] = Form.useForm();

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        await onSubmit({ ...defaultValue, ...values });
        onClose();
      })
      .catch(console.error);
  };

  const sql = defaultValue ? defaultValue.sql : '';

  return (
    <Modal
      title="Save as view"
      centered
      confirmLoading={loading}
      destroyOnClose
      maskClosable={false}
      okText="Save"
      onCancel={onClose}
      onOk={submit}
      visible={visible}
      width={564}
      afterClose={() => form.resetFields()}
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label="Display name"
          name="displayName"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.SAVE_AS_VIEW.DISPLAY_NAME.REQUIRED,
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item label="SQL Statement">
          <CodeBlock code={sql} showLineNumbers />
        </Form.Item>
      </Form>
    </Modal>
  );
}
