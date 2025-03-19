import { Button, Form, Modal, Typography, Timeline } from 'antd';
import CloseCircleFilled from '@ant-design/icons/CloseCircleFilled';
import ToolOutlined from '@ant-design/icons/ToolOutlined';
import useModalAction, { ModalAction } from '@/hooks/useModalAction';
import { Error } from '@/apollo/client/graphql/__types__';

export interface Props {
  children: React.ReactNode;
  error?: Error & { invalidSql?: string };
}

export default function ErrorBoundary({ children, error }: Props) {
  const fixItModal = useModalAction();
  if (!error) return <>{children}</>;
  const hasInvalidSql = !!error.invalidSql;
  return (
    <Timeline className="px-1 -mb-4">
      <Timeline.Item dot={<CloseCircleFilled className="red-5" />}>
        <Typography.Text className="gray-8">
          {hasInvalidSql
            ? 'Failed to generate SQL statement'
            : error.shortMessage}
        </Typography.Text>
        <div className="gray-7 text-sm mt-1">
          <div>
            {hasInvalidSql
              ? 'We tried to generate SQL based on your question but encountered a small issue. Help us fix it!'
              : error.message}
          </div>
          {hasInvalidSql && (
            <>
              <Button
                className="mt-2 adm-fix-it-btn"
                icon={<ToolOutlined />}
                size="small"
                onClick={() =>
                  fixItModal.openModal({ invalidSql: error.invalidSql })
                }
              >
                Fix it
              </Button>
              <FixSQLModal
                {...fixItModal.state}
                onClose={fixItModal.closeModal}
                onSubmit={async () => {}}
              />
            </>
          )}
        </div>
      </Timeline.Item>
    </Timeline>
  );
}

type FixSQLModalProps = ModalAction<{
  invalidSql: string;
}> & {
  loading?: boolean;
};

export function FixSQLModal(props: FixSQLModalProps) {
  const { visible, defaultValue, loading, onSubmit, onClose } = props;
  const [form] = Form.useForm();

  const submit = async () => {
    form
      .validateFields()
      .then(async (values) => {
        await onSubmit({ data: values });
        onClose();
      })
      .catch(console.error);
  };

  return (
    <Modal
      title="Fix SQL"
      width={560}
      visible={visible}
      okText="Submit"
      onOk={submit}
      onCancel={onClose}
      confirmLoading={loading}
      maskClosable={false}
      destroyOnClose
      centered
      afterClose={() => form.resetFields()}
    >
      <Typography.Text className="gray-8">
        The following SQL statement needs to be fixed:
      </Typography.Text>
      <Form form={form}>
        <pre className="mt-3 p-4 bg-gray-50 rounded">
          {defaultValue?.invalidSql}
        </pre>
      </Form>
    </Modal>
  );
}
