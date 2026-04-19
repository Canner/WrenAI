import { useEffect } from 'react';
import { Form } from 'antd';
import {
  DATABASE_PROVIDER_EXAMPLES,
  type ConnectorFormValues,
} from './connectorsPageUtils';

export default function useConnectorEditorFields({
  form,
}: {
  form: ReturnType<typeof Form.useForm<ConnectorFormValues>>[0];
}) {
  const watchedConnectorType = Form.useWatch('type', form);
  const watchedDatabaseProvider = Form.useWatch('databaseProvider', form);
  const watchedSnowflakeAuthMode = Form.useWatch('dbSnowflakeAuthMode', form);
  const watchedRedshiftAuthMode = Form.useWatch('dbRedshiftAuthMode', form);
  const databaseProviderExample =
    watchedConnectorType === 'database' && watchedDatabaseProvider
      ? DATABASE_PROVIDER_EXAMPLES[watchedDatabaseProvider]
      : null;

  useEffect(() => {
    if (watchedConnectorType === 'database' && !watchedDatabaseProvider) {
      form.setFieldsValue({ databaseProvider: 'postgres' });
    }
  }, [form, watchedConnectorType, watchedDatabaseProvider]);

  useEffect(() => {
    if (
      watchedConnectorType === 'database' &&
      watchedDatabaseProvider === 'snowflake' &&
      !watchedSnowflakeAuthMode
    ) {
      form.setFieldsValue({ dbSnowflakeAuthMode: 'password' });
    }
  }, [
    form,
    watchedConnectorType,
    watchedDatabaseProvider,
    watchedSnowflakeAuthMode,
  ]);

  useEffect(() => {
    if (
      watchedConnectorType === 'database' &&
      watchedDatabaseProvider === 'redshift' &&
      !watchedRedshiftAuthMode
    ) {
      form.setFieldsValue({ dbRedshiftAuthMode: 'redshift' });
    }
  }, [
    form,
    watchedConnectorType,
    watchedDatabaseProvider,
    watchedRedshiftAuthMode,
  ]);

  return {
    watchedConnectorType,
    watchedDatabaseProvider,
    watchedSnowflakeAuthMode,
    watchedRedshiftAuthMode,
    databaseProviderExample,
  };
}
