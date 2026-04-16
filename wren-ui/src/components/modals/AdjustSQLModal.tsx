import { useEffect, useState } from 'react';
import { Alert, Button, Form, Modal, Typography, message } from 'antd';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import { ERROR_TEXTS } from '@/utils/error';
import { ModalAction } from '@/hooks/useModalAction';
import SQLEditor from '@/components/editor/SQLEditor';
import { isApolloLikeError, parseGraphQLError } from '@/utils/errorHandler';
import ErrorCollapse from '@/components/ErrorCollapse';
import PreviewData from '@/components/dataPreview/PreviewData';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  previewSql,
  validateSql,
  type SqlPreviewDataResponse,
} from '@/utils/sqlPreviewRest';

interface AdjustSQLFormValues {
  responseId: number;
  sql: string;
}

type Props = ModalAction<AdjustSQLFormValues, AdjustSQLFormValues> & {
  loading?: boolean;
};

export default function AdjustSQLModal(props: Props) {
  const { defaultValue, loading, onClose, onSubmit, visible } = props;

  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [form] = Form.useForm();
  const [error, setError] =
    useState<ReturnType<typeof parseGraphQLError>>(null);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<
    SqlPreviewDataResponse | undefined
  >(undefined);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);

  const sqlValue = Form.useWatch('sql', form);

  useEffect(() => {
    if (visible) {
      form.setFieldsValue({
        sql: defaultValue?.sql,
      });
    }
  }, [visible, defaultValue, form]);

  const handleReset = () => {
    setPreviewData(undefined);
    setShowPreview(false);
    setError(null);
    form.resetFields();
  };

  const onValidateSQL = async () => {
    await validateSql(runtimeScopeNavigation.selector, sqlValue);
  };

  const handleError = (error: unknown) => {
    if (isApolloLikeError(error)) {
      const graphQLError = parseGraphQLError(error);
      setError({
        message: graphQLError?.message || error.message,
        shortMessage: 'SQL 语法无效',
        code: graphQLError?.code || '',
        stacktrace: graphQLError?.stacktrace,
      });
      return;
    }
    setError({
      message: error instanceof Error ? error.message : 'SQL 语法无效',
      shortMessage: 'SQL 语法无效',
      code: '',
      stacktrace: undefined,
    });
  };

  const onPreviewData = async () => {
    setError(null);
    setPreviewing(true);
    try {
      await onValidateSQL();
      setShowPreview(true);
      const data = await previewSql(runtimeScopeNavigation.selector, sqlValue);
      setPreviewData(data);
    } catch (error) {
      setShowPreview(false);
      setPreviewData(undefined);
      handleError(error);
    } finally {
      setPreviewing(false);
    }
  };

  const onSubmitButton = () => {
    setError(null);
    setSubmitting(true);
    setShowPreview(false);
    form
      .validateFields()
      .then(async (values) => {
        try {
          await onValidateSQL();
          if (!onSubmit || !defaultValue?.responseId) {
            return;
          }
          await onSubmit({
            responseId: defaultValue.responseId,
            sql: values.sql,
          });
          onClose();
        } catch (error) {
          handleError(error);
        } finally {
          setSubmitting(false);
        }
      })
      .catch((err) => {
        setSubmitting(false);
        message.error(err?.message || 'SQL 调整失败，请稍后重试。');
      });
  };

  const confirmLoading = loading || submitting;
  const disabled = !sqlValue;

  return (
    <Modal
      title="调整 SQL"
      centered
      closable
      confirmLoading={confirmLoading}
      destroyOnClose
      maskClosable={false}
      onCancel={onClose}
      visible={visible}
      width={640}
      cancelButtonProps={{ disabled: confirmLoading }}
      okButtonProps={{ disabled: previewing }}
      afterClose={() => handleReset()}
      footer={
        <div className="d-flex justify-space-between align-center">
          <div
            className="text-sm ml-2 d-flex justify-space-between align-center"
            style={{ width: 300 }}
          >
            <InfoCircleOutlined className="mr-2 text-sm gray-7" />
            <Typography.Text
              type="secondary"
              className="text-sm gray-7 text-left"
            >
              这里使用的是 <b>Wren SQL</b>，它基于 ANSI
              SQL，并针对当前语义引擎做了优化。{` `}
              <Typography.Link
                type="secondary"
                href="https://docs.getwren.ai/oss/guide/home/wren_sql"
                target="_blank"
                rel="noopener noreferrer"
              >
                了解语法说明。
              </Typography.Link>
            </Typography.Text>
          </div>
          <div>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              onClick={onSubmitButton}
              loading={confirmLoading}
            >
              提交
            </Button>
          </div>
        </div>
      }
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label="SQL 语句"
          name="sql"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.SQL_PAIR.SQL.REQUIRED,
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
          onClick={onPreviewData}
          loading={previewing}
          disabled={disabled}
        >
          预览数据
        </Button>
        {showPreview && (
          <div className="my-3">
            <PreviewData
              loading={previewing}
              previewData={previewData}
              copyable={false}
            />
          </div>
        )}
      </div>
      {!!error && (
        <Alert
          showIcon
          type="error"
          message={error.shortMessage || '调整 SQL 失败'}
          description={
            <ErrorCollapse
              message={error.message || '未知错误，请稍后重试。'}
            />
          }
        />
      )}
    </Modal>
  );
}
