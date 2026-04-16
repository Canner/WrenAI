import { useState } from 'react';
import { Modal, Form, Alert } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { getDataSourceImage, getDataSourceName } from '@/utils/dataSourceType';
import { DATA_SOURCES } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import SQLEditor from '@/components/editor/SQLEditor';
import ErrorCollapse from '@/components/ErrorCollapse';
import { DataSource, DataSourceName } from '@/types/api';
import { substituteDialectSql } from '@/utils/modelingRest';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';

type Props = ModalAction<{ dataSource: DATA_SOURCES }>;

const Toolbar = (props: { dataSource?: DATA_SOURCES }) => {
  const { dataSource } = props;
  if (!dataSource) return null;
  const logo = getDataSourceImage(dataSource);
  const name = getDataSourceName(dataSource);
  return (
    <>
      <span className="d-flex align-center gx-2">
        <img src={logo || undefined} alt="logo" width="20" height="20" />
        {name}
      </span>
    </>
  );
};

export const isSupportSubstitute = (dataSource?: DataSource) => {
  // DuckDB not supported, sample dataset as well
  return (
    !dataSource?.sampleDataset && dataSource?.type !== DataSourceName.DUCKDB
  );
};

export default function ImportDataSourceSQLModal(props: Props) {
  const { visible, defaultValue, onSubmit, onClose } = props;
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const selectedDataSource = defaultValue?.dataSource;
  const name = selectedDataSource
    ? getDataSourceName(selectedDataSource) || '数据源'
    : '数据源';
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
      setError({
        message:
          nextError instanceof Error
            ? nextError.message
            : `${name} SQL 导入失败，请稍后重试。`,
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
      destroyOnClose
      maskClosable={false}
      onCancel={onClose}
      onOk={submit}
      okText="转换"
      cancelText="取消"
      visible={visible}
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
            toolbar={<Toolbar dataSource={defaultValue?.dataSource} />}
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
