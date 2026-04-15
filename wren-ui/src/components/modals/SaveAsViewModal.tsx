import { useCallback } from 'react';
import { Button, Form, Input, Modal, Typography } from 'antd';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import { ModalAction } from '@/hooks/useModalAction';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { handleFormSubmitError } from '@/utils/errorHandler';
import { createViewNameValidator } from '@/utils/validator';
import { validateViewName } from '@/utils/viewRest';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';

const { Text } = Typography;

type Props = ModalAction<{ sql: string }> & {
  loading?: boolean;
  defaultValue: { sql: string; responseId: number };
  payload: { rephrasedQuestion: string };
};

export default function SaveAsViewModal(props: Props) {
  const { visible, loading, onSubmit, onClose, defaultValue, payload } = props;
  const [form] = Form.useForm();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const validateViewNameRequest = useCallback(
    (name: string) =>
      validateViewName(runtimeScopeNavigation.selector, {
        name,
      }),
    [runtimeScopeNavigation.selector],
  );

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        if (!onSubmit) {
          return;
        }
        await onSubmit({
          responseId: defaultValue.responseId,
          ...payload,
          ...values,
        });
        onClose();
      })
      .catch((error) => {
        handleFormSubmitError(error, '保存视图失败，请稍后重试。');
      });
  };

  const sql = defaultValue ? defaultValue.sql : '';

  return (
    <Modal
      title="保存为视图"
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
              保存后，请前往“建模页”统一部署所有已保存视图。
            </Text>
          </div>
          <div>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={submit} loading={loading}>
              保存
            </Button>
          </div>
        </div>
      }
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label="名称"
          name="name"
          required
          rules={[
            {
              required: true,
              validator: createViewNameValidator(validateViewNameRequest),
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item label="SQL 语句">
          <SQLCodeBlock code={sql} showLineNumbers maxHeight="300" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
