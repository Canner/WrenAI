import { useMemo } from 'react';
import { Modal, Form, Alert } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { getDataSourceImage, getDataSourceName } from '@/utils/dataSourceType';
import { DATA_SOURCES } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { handleFormSubmitError, parseGraphQLError } from '@/utils/errorHandler';
import SQLEditor from '@/components/editor/SQLEditor';
import ErrorCollapse from '@/components/ErrorCollapse';
import { useModelSubstituteMutation } from '@/apollo/client/graphql/sql.generated';
import { DataSource, DataSourceName } from '@/apollo/client/graphql/__types__';

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
  const selectedDataSource = defaultValue?.dataSource;
  const name = selectedDataSource
    ? getDataSourceName(selectedDataSource) || '数据源'
    : '数据源';

  // Handle errors via try/catch blocks rather than onError callback
  const [substituteDialectSQL, modelSubstitudeResult] =
    useModelSubstituteMutation();

  const error = useMemo(() => {
    if (!modelSubstitudeResult.error) {
      return null;
    }

    const parsedError = parseGraphQLError(modelSubstitudeResult.error);
    return {
      message: parsedError?.message || modelSubstitudeResult.error.message,
      shortMessage: `${name} SQL 语法无效`,
      code: parsedError?.code || '',
      stacktrace: parsedError?.stacktrace,
    };
  }, [modelSubstitudeResult.error, name]);

  const [form] = Form.useForm();

  const reset = () => {
    form.resetFields();
    modelSubstitudeResult.reset();
  };

  const submit = async () => {
    form
      .validateFields()
      .then(async (values) => {
        const response = await substituteDialectSQL({
          variables: { data: { sql: values.dialectSql } },
        });
        if (onSubmit && response.data?.modelSubstitute) {
          await onSubmit(response.data.modelSubstitute);
        }
        onClose();
      })
      .catch((error) => {
        handleFormSubmitError(error, `${name} SQL 导入失败，请稍后重试。`);
      });
  };

  const loading = modelSubstitudeResult.loading;

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
