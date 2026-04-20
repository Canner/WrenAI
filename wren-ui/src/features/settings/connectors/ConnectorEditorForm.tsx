import { Form, Input, Select, Switch, Typography } from 'antd';
import {
  CONNECTOR_CLEAR_SECRET_LABEL,
  CONNECTOR_SECRET_EDIT_HINT,
  CONNECTOR_TEST_HINT,
  DATABASE_PROVIDER_OPTIONS,
  REDSHIFT_AUTH_MODE_OPTIONS,
  SNOWFLAKE_AUTH_MODE_OPTIONS,
  type ConnectorFormValues,
  type ConnectorView,
} from './connectorsPageUtils';

const { Paragraph } = Typography;

type ConnectorEditorFormProps = {
  editingConnector?: ConnectorView | null;
  form: any;
  watchedConnectorType?: string;
  watchedDatabaseProvider?: string;
  watchedSnowflakeAuthMode?: 'password' | 'privateKey';
  watchedRedshiftAuthMode?: 'redshift' | 'redshift_iam';
  clearSecretChecked: boolean;
  databaseProviderExample?: { config: string; secret: string } | null;
  connectorTypeOptions: Array<{ label: string; value: string }>;
  onClearSecretCheckedChange: (checked: boolean) => void;
};

export default function ConnectorEditorForm({
  editingConnector,
  form,
  watchedConnectorType,
  watchedDatabaseProvider,
  watchedSnowflakeAuthMode,
  watchedRedshiftAuthMode,
  clearSecretChecked,
  databaseProviderExample,
  connectorTypeOptions,
  onClearSecretCheckedChange,
}: ConnectorEditorFormProps) {
  return (
    <Form<ConnectorFormValues> layout="vertical" form={form}>
      <Form.Item
        name="type"
        label="连接器类型"
        rules={[{ required: true, message: '请选择连接器类型' }]}
      >
        <Select options={connectorTypeOptions} />
      </Form.Item>
      <Paragraph type="secondary">{CONNECTOR_TEST_HINT}</Paragraph>
      {watchedConnectorType === 'database' ? (
        <Form.Item
          name="databaseProvider"
          label="数据库 Provider"
          rules={[{ required: true, message: '请选择数据库 Provider' }]}
        >
          <Select options={DATABASE_PROVIDER_OPTIONS} />
        </Form.Item>
      ) : null}
      <Form.Item
        name="displayName"
        label="显示名称"
        rules={[{ required: true, message: '请输入连接器显示名称' }]}
      >
        <Input />
      </Form.Item>
      {watchedConnectorType === 'database' ? (
        <>
          {watchedDatabaseProvider === 'postgres' ? (
            <>
              <Form.Item name="dbHost" label="Host">
                <Input placeholder="127.0.0.1" />
              </Form.Item>
              <Form.Item name="dbPort" label="Port">
                <Input placeholder="5432" />
              </Form.Item>
              <Form.Item name="dbDatabase" label="Database">
                <Input placeholder="analytics" />
              </Form.Item>
              <Form.Item name="dbUser" label="用户名">
                <Input placeholder="postgres" />
              </Form.Item>
              <Form.Item name="dbSchema" label="Schema">
                <Input placeholder="public" />
              </Form.Item>
              <Form.Item name="dbSsl" label="启用 SSL" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="dbPassword" label="密码">
                <Input
                  type="password"
                  placeholder="secret"
                  disabled={clearSecretChecked}
                />
              </Form.Item>
            </>
          ) : null}

          {watchedDatabaseProvider === 'mysql' ? (
            <>
              <Form.Item name="dbHost" label="Host">
                <Input placeholder="127.0.0.1" />
              </Form.Item>
              <Form.Item name="dbPort" label="Port">
                <Input placeholder="3306" />
              </Form.Item>
              <Form.Item name="dbDatabase" label="Database">
                <Input placeholder="analytics" />
              </Form.Item>
              <Form.Item name="dbUser" label="用户名">
                <Input placeholder="root" />
              </Form.Item>
              <Form.Item name="dbSsl" label="启用 SSL" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="dbPassword" label="密码（可选）">
                <Input
                  type="password"
                  placeholder="secret"
                  disabled={clearSecretChecked}
                />
              </Form.Item>
            </>
          ) : null}

          {watchedDatabaseProvider === 'bigquery' ? (
            <>
              <Form.Item name="dbProjectId" label="Project ID">
                <Input placeholder="my-gcp-project" />
              </Form.Item>
              <Form.Item name="dbDatasetId" label="Dataset ID">
                <Input placeholder="analytics" />
              </Form.Item>
              <Form.Item name="dbCredentialsText" label="Service Account JSON">
                <Input.TextArea
                  rows={8}
                  placeholder='{"type":"service_account","project_id":"my-gcp-project"}'
                  disabled={clearSecretChecked}
                />
              </Form.Item>
            </>
          ) : null}

          {watchedDatabaseProvider === 'snowflake' ? (
            <>
              <Form.Item name="dbSnowflakeAccount" label="Account">
                <Input placeholder="org-account" />
              </Form.Item>
              <Form.Item name="dbDatabase" label="Database">
                <Input placeholder="ANALYTICS" />
              </Form.Item>
              <Form.Item name="dbSchema" label="Schema">
                <Input placeholder="PUBLIC" />
              </Form.Item>
              <Form.Item name="dbSnowflakeWarehouse" label="Warehouse">
                <Input placeholder="COMPUTE_WH" />
              </Form.Item>
              <Form.Item name="dbUser" label="用户名">
                <Input placeholder="analyst" />
              </Form.Item>
              <Form.Item name="dbSnowflakeAuthMode" label="认证方式">
                <Select options={SNOWFLAKE_AUTH_MODE_OPTIONS} />
              </Form.Item>
              {watchedSnowflakeAuthMode === 'privateKey' ? (
                <Form.Item name="dbPrivateKey" label="Private Key">
                  <Input.TextArea
                    rows={6}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                    disabled={clearSecretChecked}
                  />
                </Form.Item>
              ) : (
                <Form.Item name="dbPassword" label="密码">
                  <Input
                    type="password"
                    placeholder="secret"
                    disabled={clearSecretChecked}
                  />
                </Form.Item>
              )}
            </>
          ) : null}

          {watchedDatabaseProvider === 'redshift' ? (
            <>
              <Form.Item name="dbRedshiftAuthMode" label="认证方式">
                <Select options={REDSHIFT_AUTH_MODE_OPTIONS} />
              </Form.Item>
              {watchedRedshiftAuthMode === 'redshift_iam' ? (
                <>
                  <Form.Item
                    name="dbClusterIdentifier"
                    label="Cluster Identifier"
                  >
                    <Input placeholder="my-redshift-cluster" />
                  </Form.Item>
                  <Form.Item name="dbAwsRegion" label="AWS Region">
                    <Input placeholder="us-east-1" />
                  </Form.Item>
                  <Form.Item name="dbDatabase" label="Database">
                    <Input placeholder="analytics" />
                  </Form.Item>
                  <Form.Item name="dbUser" label="用户名">
                    <Input placeholder="analyst" />
                  </Form.Item>
                  <Form.Item name="dbAwsAccessKey" label="AWS Access Key">
                    <Input
                      placeholder="AKIA..."
                      disabled={clearSecretChecked}
                    />
                  </Form.Item>
                  <Form.Item name="dbAwsSecretKey" label="AWS Secret Key">
                    <Input
                      type="password"
                      placeholder="secret"
                      disabled={clearSecretChecked}
                    />
                  </Form.Item>
                </>
              ) : (
                <>
                  <Form.Item name="dbHost" label="Host">
                    <Input placeholder="cluster.region.redshift.amazonaws.com" />
                  </Form.Item>
                  <Form.Item name="dbPort" label="Port">
                    <Input placeholder="5439" />
                  </Form.Item>
                  <Form.Item name="dbDatabase" label="Database">
                    <Input placeholder="analytics" />
                  </Form.Item>
                  <Form.Item name="dbUser" label="用户名">
                    <Input placeholder="analyst" />
                  </Form.Item>
                  <Form.Item name="dbSchema" label="Schema">
                    <Input placeholder="public" />
                  </Form.Item>
                  <Form.Item name="dbPassword" label="密码">
                    <Input
                      type="password"
                      placeholder="secret"
                      disabled={clearSecretChecked}
                    />
                  </Form.Item>
                </>
              )}
            </>
          ) : null}

          {watchedDatabaseProvider === 'trino' ? (
            <>
              <Form.Item name="dbHost" label="Host">
                <Input placeholder="trino.internal" />
              </Form.Item>
              <Form.Item name="dbPort" label="Port">
                <Input placeholder="8080" />
              </Form.Item>
              <Form.Item name="dbTrinoSchemas" label="Schemas">
                <Input placeholder="catalog.public,catalog_2.finance" />
              </Form.Item>
              <Form.Item name="dbUser" label="用户名">
                <Input placeholder="analyst" />
              </Form.Item>
              <Form.Item name="dbSsl" label="启用 SSL" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="dbPassword" label="密码（可选）">
                <Input
                  type="password"
                  placeholder="secret"
                  disabled={clearSecretChecked}
                />
              </Form.Item>
            </>
          ) : null}
        </>
      ) : (
        <>
          <Form.Item name="configText" label="配置 JSON">
            <Input.TextArea
              rows={8}
              placeholder={
                databaseProviderExample?.config ||
                '{"baseUrl": "https://api.example.com", "timeoutMs": 3000}'
              }
            />
          </Form.Item>
          <Form.Item name="secretText" label="密钥 JSON">
            <Input.TextArea
              rows={6}
              placeholder={
                databaseProviderExample?.secret || '{"apiKey": "secret-token"}'
              }
              disabled={clearSecretChecked}
            />
          </Form.Item>
        </>
      )}
      {editingConnector?.hasSecret ? (
        <Form.Item label={CONNECTOR_CLEAR_SECRET_LABEL}>
          <Switch
            checked={clearSecretChecked}
            onChange={onClearSecretCheckedChange}
          />
        </Form.Item>
      ) : null}
      {editingConnector ? (
        <Paragraph className="gray-7 mb-0">
          {CONNECTOR_SECRET_EDIT_HINT}
        </Paragraph>
      ) : null}
    </Form>
  );
}
