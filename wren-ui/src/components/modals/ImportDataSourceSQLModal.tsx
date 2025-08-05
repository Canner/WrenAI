import { useMemo } from 'react';
import { Modal, Form, Alert } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { getDataSourceImage, getDataSourceName } from '@/utils/dataSourceType';
import { DATA_SOURCES } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { parseGraphQLError } from '@/utils/errorHandler';
import SQLEditor from '@/components/editor/SQLEditor';
import ErrorCollapse from '@/components/ErrorCollapse';
import { useModelSubstituteMutation } from '@/apollo/client/graphql/sql.generated';
import { DataSource, DataSourceName } from '@/apollo/client/graphql/__types__';

type Props = ModalAction<{ dataSource: DATA_SOURCES }>;

const Toolbar = (props) => {
  const { dataSource } = props;
  if (!dataSource) return null;
  const logo = getDataSourceImage(dataSource);
  const name = getDataSourceName(dataSource);
  return (
    <>
      <span className="d-flex align-center gx-2">
        <img src={logo} alt="logo" width="20" height="20" />
        {name}
      </span>
    </>
  );
};

export const isSupportSubstitute = (dataSource: DataSource) => {
  // DuckDB not supported, sample dataset as well
  return (
    !dataSource?.sampleDataset && dataSource?.type !== DataSourceName.DUCKDB
  );
};

export default function ImportDataSourceSQLModal(props: Props) {
  const { visible, defaultValue, onSubmit, onClose } = props;
  const name = getDataSourceName(defaultValue?.dataSource) || 'data source';

  // Handle errors via try/catch blocks rather than onError callback
  const [substituteDialectSQL, modelSubstitudeResult] =
    useModelSubstituteMutation();

  const error = useMemo(
    () =>
      modelSubstitudeResult.error
        ? {
            ...parseGraphQLError(modelSubstitudeResult.error),
            shortMessage: `Invalid ${name} SQL syntax`,
          }
        : null,
    [modelSubstitudeResult.error],
  );

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
        await onSubmit(response.data?.modelSubstitute);
        onClose();
      })
      .catch(console.error);
  };

  const loading = modelSubstitudeResult.loading;

  return (
    <Modal
      title={`Import from ${name} SQL`}
      centered
      closable
      confirmLoading={loading}
      destroyOnClose
      maskClosable={false}
      onCancel={onClose}
      onOk={submit}
      okText="Convert"
      visible={visible}
      width={600}
      cancelButtonProps={{ disabled: loading }}
      afterClose={() => reset()}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="dialectSql"
          label="SQL statement"
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
