import { DataSourceName, DataSource } from '@/types/dataSource';
import { useState } from 'react';
import { Modal, Form, Alert } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import {
  getConnectionTypeImage,
  getConnectionTypeName,
} from '@/utils/connectionType';
import { DATA_SOURCES } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import SQLEditor from '@/components/editor/SQLEditor';
import ErrorCollapse from '@/components/ErrorCollapse';

import { substituteDialectSql } from '@/utils/modelingRest';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';

type Props = ModalAction<{ connectionType: DATA_SOURCES }>;

const Toolbar = (props: { connectionType?: DATA_SOURCES }) => {
  const { connectionType } = props;
  if (!connectionType) return null;
  const logo = getConnectionTypeImage(connectionType);
  const name = getConnectionTypeName(connectionType);
  return (
    <>
      <span className="d-flex align-center gx-2">
        <img src={logo || undefined} alt="logo" width="20" height="20" />
        {name}
      </span>
    </>
  );
};

export const isSupportSubstitute = (connection?: DataSource) => {
  // DuckDB not supported, sample dataset as well
  return (
    !connection?.sampleDataset && connection?.type !== DataSourceName.DUCKDB
  );
};

export default function ImportConnectionSQLModal(props: Props) {
  const { visible, defaultValue, onSubmit, onClose } = props;
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const selectedConnectionType = defaultValue?.connectionType;
  const name = selectedConnectionType
    ? getConnectionTypeName(selectedConnectionType) || '当前连接'
    : '当前连接';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    message: string;
    shortMessage: string;
  } | null>(null);

  const [form] = Form.useForm();

  const reset = () => {
    form.resetFields();
    setError(null);
  };

  const submit = async () => {
    setError(null);
    try {
      const values = await form.validateFields();
      setLoading(true);
      const substitutedSql = await substituteDialectSql(
        runtimeScopeNavigation.selector,
        values.dialectSql,
      );
      if (onSubmit) {
        await onSubmit(substitutedSql);
      }
      onClose();
    } catch (nextError) {
      if (
        nextError &&
        typeof nextError === 'object' &&
        'errorFields' in nextError
      ) {
        return;
      }
      const errorMessage = resolveAbortSafeErrorMessage(
        nextError,
        `${name} SQL 导入失败，请稍后重试。`,
      );
      if (!errorMessage) {
        return;
      }
      setError({
        message: errorMessage,
        shortMessage: `${name} SQL 语法无效`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={`从 ${name} SQL 导入`}
      centered
      closable
      confirmLoading={loading}
      destroyOnHidden
      mask={{ closable: false }}
      onCancel={onClose}
      onOk={submit}
      okText="转换"
      cancelText="取消"
      open={visible}
      width={600}
      cancelButtonProps={{ disabled: loading }}
      afterClose={() => reset()}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="dialectSql"
          label="SQL 语句"
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.IMPORT_DATA_SOURCE_SQL.SQL.REQUIRED,
            },
          ]}
        >
          <SQLEditor
            toolbar={<Toolbar connectionType={defaultValue?.connectionType} />}
            autoFocus
          />
        </Form.Item>
      </Form>
      {!!error && (
        <Alert
          showIcon
          type="error"
          message={error.shortMessage}
          description={<ErrorCollapse message={error.message} />}
        />
      )}
    </Modal>
  );
}
