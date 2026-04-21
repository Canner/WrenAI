import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Modal, Typography, Alert } from 'antd';
import { ERROR_TEXTS } from '@/utils/error';
import { ModalAction } from '@/hooks/useModalAction';
import {
  handleFormSubmitError,
  parseOperationError,
} from '@/utils/errorHandler';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import SQLEditor from '@/components/editor/SQLEditor';
import ErrorCollapse from '@/components/ErrorCollapse';
import PreviewData from '@/components/dataPreview/PreviewData';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  previewSql,
  validateSql,
  type SqlPreviewDataResponse,
} from '@/utils/sqlPreviewRest';

type Props = ModalAction<{ sql: string; responseId: number }> & {
  loading?: boolean;
};

export function FixSQLModal(props: Props) {
  const { visible, defaultValue, loading, onSubmit, onClose } = props;
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [form] = Form.useForm();
  const [previewState, setPreviewState] = useState<{
    loading: boolean;
    data?: SqlPreviewDataResponse;
    error?: Error;
  }>({
    loading: false,
  });

  const error = useMemo(() => {
    if (!previewState.error) return null;
    const errorMessage = resolveAbortSafeErrorMessage(
      previewState.error,
      '预览 SQL 数据失败，请稍后重试。',
    );
    if (!errorMessage) {
      return null;
    }
    const operationError = parseOperationError(previewState.error as any);
    return {
      ...operationError,
      message: operationError?.message || errorMessage,
      shortMessage: 'SQL 语法无效',
    };
  }, [previewState.error]);

  useEffect(() => {
    if (!visible) return;
    form.setFieldsValue(defaultValue || {});
  }, [form, defaultValue, visible]);

  const onValidateSql = async (sql: string) => {
    await validateSql(runtimeScopeNavigation.selector, sql);
  };

  const previewData = async () => {
    form
      .validateFields()
      .then(async (values) => {
        setPreviewState({ loading: true });
        try {
          const data = await previewSql(
            runtimeScopeNavigation.selector,
            values.sql,
            50,
          );
          setPreviewState({
            loading: false,
            data,
          });
        } catch (error) {
          setPreviewState({
            loading: false,
            data: undefined,
            error:
              error instanceof Error
                ? error
                : new Error('预览 SQL 数据失败，请稍后重试。'),
          });
        }
      })
      .catch((error) => {
        handleFormSubmitError(error, '预览 SQL 数据失败，请稍后重试。');
      });
  };

  const reset = () => {
    form.resetFields();
    setPreviewState({ loading: false });
  };

  const submit = async () => {
    form
      .validateFields()
      .then(async (values) => {
        await onValidateSql(values.sql);
        if (!onSubmit) {
          return;
        }
        await onSubmit(values.sql);
        onClose();
      })
      .catch((error) => {
        handleFormSubmitError(error, '提交修复 SQL 失败，请稍后重试。');
      });
  };

  const showPreview = previewState.data || previewState.loading;

  return (
    <Modal
      title="修复 SQL"
      width={640}
      open={visible}
      okText="提交"
      cancelText="取消"
      onOk={submit}
      onCancel={onClose}
      confirmLoading={loading}
      mask={{ closable: false }}
      destroyOnHidden
      centered
      afterClose={reset}
    >
      <Typography.Text className="d-block gray-7 mb-3">
        以下 SQL 语句需要修复：
      </Typography.Text>
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label="SQL 语句"
          name="sql"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.FIX_SQL.SQL.REQUIRED,
            },
          ]}
        >
          <SQLEditor autoComplete autoFocus />
        </Form.Item>
      </Form>
      <div className="my-3">
        <Typography.Text className="d-block gray-7 mb-2">
          数据预览（50 行）
        </Typography.Text>
        <Button
          onClick={previewData}
          loading={previewState.loading}
          disabled={previewState.loading}
        >
          预览数据
        </Button>
        {showPreview && (
          <div className="my-3">
            <PreviewData
              loading={previewState.loading}
              previewData={previewState.data}
              copyable={false}
            />
          </div>
        )}
      </div>
      {!!error && (
        <Alert
          showIcon
          type="error"
          message={error.shortMessage}
          description={<ErrorCollapse message={error.message || ''} />}
        />
      )}
    </Modal>
  );
}
