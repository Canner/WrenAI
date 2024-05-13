import { Button, Form, Input, Modal, Typography } from 'antd';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import { ModalAction } from '@/hooks/useModalAction';
import { createViewNameValidator } from '@/utils/validator';
import CodeBlock from '@/components/editor/CodeBlock';
import { useValidateViewMutation } from '@/apollo/client/graphql/view.generated';

const { Text } = Typography;

type Props = ModalAction<{ sql: string }> & {
  loading?: boolean;
  defaultValue: { sql: string; responseId: number };
};

export default function SaveAsViewModal(props: Props) {
  const { visible, loading, onSubmit, onClose, defaultValue } = props;
  const [form] = Form.useForm();
  const [validateViewMutation] = useValidateViewMutation({
    fetchPolicy: 'no-cache',
  });

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        await onSubmit({ responseId: defaultValue.responseId, ...values });
        onClose();
      })
      .catch(console.error);
  };

  const sql = defaultValue ? defaultValue.sql : '';

  return (
    <Modal
      title="Save as View"
      centered
      closable
      destroyOnClose
      onCancel={onClose}
      maskClosable={false}
      visible={visible}
      width={600}
      afterClose={() => form.resetFields()}
      footer={
        <div className="d-flex justify-space-between align-center">
          <div
            className="d-flex justify-space-between align-center ml-2"
            style={{ width: 300 }}
          >
            <InfoCircleOutlined className="mr-2 text-sm gray-6" />
            <Text type="secondary" className="text-sm gray-6 text-left">
              After saving, make sure you go to "Modeling Page" to deploy all
              saved views.
            </Text>
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
              validator: createViewNameValidator(validateViewMutation),
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item label="SQL Statement">
          <CodeBlock code={sql} showLineNumbers maxHeight="300" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
