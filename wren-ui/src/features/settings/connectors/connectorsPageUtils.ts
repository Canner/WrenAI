import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';

export type ConnectorView = {
  id: string;
  workspaceId: string;
  knowledgeBaseId?: string | null;
  type: string;
  databaseProvider?: string | null;
  trinoCatalogName?: string | null;
  displayName: string;
  config?: Record<string, any> | null;
  hasSecret?: boolean;
  createdBy?: string | null;
};

export type ConnectorFormValues = {
  type: string;
  databaseProvider?: string;
  displayName: string;
  configText?: string;
  secretText?: string;
  clearSecret?: boolean;
  dbHost?: string;
  dbPort?: string;
  dbDatabase?: string;
  dbUser?: string;
  dbSchema?: string;
  dbSsl?: boolean;
  dbProjectId?: string;
  dbDatasetId?: string;
  dbCredentialsText?: string;
  dbSnowflakeAccount?: string;
  dbSnowflakeWarehouse?: string;
  dbSnowflakeAuthMode?: 'password' | 'privateKey';
  dbPassword?: string;
  dbPrivateKey?: string;
  dbRedshiftAuthMode?: 'redshift' | 'redshift_iam';
  dbClusterIdentifier?: string;
  dbAwsRegion?: string;
  dbAwsAccessKey?: string;
  dbAwsSecretKey?: string;
  dbTrinoSchemas?: string;
};

export type ConnectorSubmitPayload = {
  type: string;
  databaseProvider?: string | null;
  displayName: string;
  config: Record<string, any> | null;
  secret?: Record<string, any> | null;
};

export type ConnectorTestPayload = {
  connectorId?: string;
  type: string;
  databaseProvider?: string | null;
  config: Record<string, any> | null;
  secret?: Record<string, any> | null;
};

export type ConnectorTestResponse = {
  success: boolean;
  message: string;
  tableCount?: number;
  sampleTables?: string[];
  version?: string | null;
};

export type SecretReencryptSummary = {
  dryRun: boolean;
  scanned: number;
  eligible: number;
  updated: number;
  skipped: number;
  targetKeyVersion: number;
  filters?: {
    workspaceId?: string;
    scopeType?: string;
    sourceKeyVersion?: number;
  };
  records?: Array<{
    id: string;
    workspaceId: string;
    scopeType: string;
    scopeId: string;
    fromKeyVersion: number;
    toKeyVersion: number;
  }>;
};

export type SecretReencryptPayload = {
  targetKeyVersion: number;
  sourceKeyVersion?: number;
  scopeType?: string;
  execute?: boolean;
};

export const buildConnectorsCollectionUrl = (
  selector?: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl('/api/v1/connectors', {}, selector);

export const buildConnectorsCollectionRequestKey = (
  selector?: ClientRuntimeScopeSelector | null,
) => selector?.workspaceId || null;

export const normalizeConnectorsCollectionPayload = (
  payload: unknown,
): ConnectorView[] =>
  Array.isArray(payload) ? (payload as ConnectorView[]) : [];

export const buildConnectorItemUrl = (
  id: string,
  selector?: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl(`/api/v1/connectors/${id}`, {}, selector);

export const buildConnectorTestUrl = (selector?: ClientRuntimeScopeSelector) =>
  buildRuntimeScopeUrl('/api/v1/connectors/test', {}, selector);

export const buildSecretReencryptApiUrl = (
  selector?: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl('/api/v1/secrets/reencrypt', {}, selector);

export const resolveConnectorWorkspaceSelector = ({
  runtimeSelector,
  sessionWorkspaceId,
  actorWorkspaceId,
}: {
  runtimeSelector?: ClientRuntimeScopeSelector | null;
  sessionWorkspaceId?: string | null;
  actorWorkspaceId?: string | null;
}): ClientRuntimeScopeSelector | null => {
  const workspaceId =
    runtimeSelector?.workspaceId ||
    sessionWorkspaceId ||
    actorWorkspaceId ||
    null;

  return workspaceId ? { workspaceId } : null;
};

export const CONNECTOR_TYPE_OPTIONS = [
  { label: 'REST JSON API', value: 'rest_json' },
  { label: '数据库', value: 'database' },
  { label: 'Python 工具', value: 'python_tool' },
];

export const DATABASE_PROVIDER_OPTIONS = [
  { label: 'PostgreSQL', value: 'postgres' },
  { label: 'MySQL', value: 'mysql' },
  { label: 'BigQuery', value: 'bigquery' },
  { label: 'Snowflake', value: 'snowflake' },
  { label: 'Redshift', value: 'redshift' },
  { label: 'Trino', value: 'trino' },
];

export const SNOWFLAKE_AUTH_MODE_OPTIONS = [
  { label: 'Password', value: 'password' },
  { label: 'Private Key', value: 'privateKey' },
];

export const REDSHIFT_AUTH_MODE_OPTIONS = [
  { label: 'Password', value: 'redshift' },
  { label: 'IAM', value: 'redshift_iam' },
];

export const CONNECTOR_SECRET_EDIT_HINT =
  '若保持密钥 JSON 为空，将继续沿用现有密钥，不会被覆盖。';
export const CONNECTOR_CLEAR_SECRET_LABEL = '清空现有密钥';
export const CONNECTOR_TEST_HINT =
  '当前仅 database 类型支持连接测试；其它连接器类型会先保存定义，后续再接执行链路。';
export const CONNECTOR_SECRET_ROTATION_HINT =
  '密钥仍按应用层加密存储；这里的批量轮换只会重加密 secret_record，不会暴露明文。';

export const DATABASE_PROVIDER_EXAMPLES: Record<
  string,
  { config: string; secret: string }
> = {
  postgres: {
    config:
      '{"host":"127.0.0.1","port":5432,"database":"analytics","user":"postgres","schema":"public","ssl":false}',
    secret: '{"password":"postgres"}',
  },
  mysql: {
    config:
      '{"host":"127.0.0.1","port":3306,"database":"analytics","user":"root","ssl":false}',
    secret: '{"password":"secret"}',
  },
  bigquery: {
    config: '{"projectId":"my-gcp-project","datasetId":"analytics"}',
    secret:
      '{"credentials":{"type":"service_account","project_id":"my-gcp-project"}}',
  },
  snowflake: {
    config:
      '{"account":"org-account","database":"ANALYTICS","schema":"PUBLIC","warehouse":"COMPUTE_WH","user":"analyst"}',
    secret: '{"password":"secret"}',
  },
  redshift: {
    config:
      '{"host":"cluster.region.redshift.amazonaws.com","port":5439,"database":"analytics","user":"analyst","schema":"public","redshiftType":"redshift"}',
    secret: '{"password":"secret"}',
  },
  trino: {
    config:
      '{"host":"trino.internal","port":8080,"schemas":"catalog.public","username":"analyst","ssl":false}',
    secret: '{"password":"secret"}',
  },
};

const parseOptionalJsonObject = (value?: string) => {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const parsed = JSON.parse(value);
  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
    throw new Error('JSON 内容必须是对象');
  }

  return parsed;
};

export const stringifyJson = (value?: Record<string, any> | null) =>
  value ? JSON.stringify(value, null, 2) : '';

const readText = (value?: string | null) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const pickDefinedObject = (value: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );

type DatabaseConnectorFormShape = Partial<ConnectorFormValues> & {
  databaseProvider?: string;
};

const hasStructuredDatabaseConfigInput = (values: DatabaseConnectorFormShape) =>
  Boolean(
    readText(values.dbHost) ||
      readText(values.dbPort) ||
      readText(values.dbDatabase) ||
      readText(values.dbUser) ||
      readText(values.dbSchema) ||
      readText(values.dbProjectId) ||
      readText(values.dbDatasetId) ||
      readText(values.dbSnowflakeAccount) ||
      readText(values.dbSnowflakeWarehouse) ||
      readText(values.dbClusterIdentifier) ||
      readText(values.dbAwsRegion) ||
      readText(values.dbTrinoSchemas),
  );

const hasStructuredDatabaseSecretInput = (values: DatabaseConnectorFormShape) =>
  Boolean(
    readText(values.dbPassword) ||
      readText(values.dbPrivateKey) ||
      readText(values.dbCredentialsText) ||
      readText(values.dbAwsAccessKey) ||
      readText(values.dbAwsSecretKey),
  );

const buildDatabaseConnectorConfig = (values: DatabaseConnectorFormShape) => {
  const provider = values.databaseProvider?.trim();
  if (!provider) {
    throw new Error('请选择数据库 Provider');
  }

  switch (provider) {
    case 'postgres':
      return pickDefinedObject({
        host: readText(values.dbHost),
        port: parsePositiveInteger(values.dbPort || '', '数据库端口'),
        database: readText(values.dbDatabase),
        user: readText(values.dbUser),
        schema: readText(values.dbSchema) || undefined,
        ssl: Boolean(values.dbSsl),
      });
    case 'mysql':
      return {
        host: readText(values.dbHost),
        port: parsePositiveInteger(values.dbPort || '', 'MySQL 端口'),
        database: readText(values.dbDatabase),
        user: readText(values.dbUser),
        ssl: Boolean(values.dbSsl),
      };
    case 'bigquery':
      return {
        projectId: readText(values.dbProjectId),
        datasetId: readText(values.dbDatasetId),
      };
    case 'snowflake':
      return pickDefinedObject({
        account: readText(values.dbSnowflakeAccount),
        database: readText(values.dbDatabase),
        schema: readText(values.dbSchema),
        warehouse: readText(values.dbSnowflakeWarehouse) || undefined,
        user: readText(values.dbUser),
      });
    case 'redshift':
      if ((values.dbRedshiftAuthMode || 'redshift') === 'redshift_iam') {
        return {
          redshiftType: 'redshift_iam',
          clusterIdentifier: readText(values.dbClusterIdentifier),
          database: readText(values.dbDatabase),
          user: readText(values.dbUser),
          awsRegion: readText(values.dbAwsRegion),
        };
      }
      return pickDefinedObject({
        redshiftType: 'redshift',
        host: readText(values.dbHost),
        port: parsePositiveInteger(values.dbPort || '', 'Redshift 端口'),
        database: readText(values.dbDatabase),
        user: readText(values.dbUser),
        schema: readText(values.dbSchema) || undefined,
      });
    case 'trino':
      return {
        host: readText(values.dbHost),
        port: parsePositiveInteger(values.dbPort || '', 'Trino 端口'),
        schemas: readText(values.dbTrinoSchemas),
        username: readText(values.dbUser),
        ssl: Boolean(values.dbSsl),
      };
    default:
      throw new Error('未知数据库 Provider');
  }
};

const buildDatabaseConnectorSecret = (values: DatabaseConnectorFormShape) => {
  const provider = values.databaseProvider?.trim();
  if (!provider) {
    throw new Error('请选择数据库 Provider');
  }

  switch (provider) {
    case 'postgres':
    case 'mysql':
    case 'trino':
      return readText(values.dbPassword)
        ? { password: readText(values.dbPassword) }
        : null;
    case 'bigquery': {
      const credentials = parseOptionalJsonObject(values.dbCredentialsText);
      return credentials ? { credentials } : null;
    }
    case 'snowflake':
      if ((values.dbSnowflakeAuthMode || 'password') === 'privateKey') {
        return readText(values.dbPrivateKey)
          ? { privateKey: readText(values.dbPrivateKey) }
          : null;
      }
      return readText(values.dbPassword)
        ? { password: readText(values.dbPassword) }
        : null;
    case 'redshift':
      if ((values.dbRedshiftAuthMode || 'redshift') === 'redshift_iam') {
        const awsAccessKey = readText(values.dbAwsAccessKey);
        const awsSecretKey = readText(values.dbAwsSecretKey);
        return awsAccessKey && awsSecretKey
          ? { awsAccessKey, awsSecretKey }
          : null;
      }
      return readText(values.dbPassword)
        ? { password: readText(values.dbPassword) }
        : null;
    default:
      return null;
  }
};

const isDatabaseSecretRequired = (values: DatabaseConnectorFormShape) => {
  switch (values.databaseProvider?.trim()) {
    case 'mysql':
    case 'trino':
      return false;
    default:
      return true;
  }
};

export const getDatabaseConnectorFormValues = (
  connector: ConnectorView,
): Partial<ConnectorFormValues> => {
  const config = connector.config || {};
  const provider = connector.databaseProvider || 'postgres';

  switch (provider) {
    case 'postgres':
      return {
        dbHost: config.host || '',
        dbPort: config.port != null ? String(config.port) : '5432',
        dbDatabase: config.database || '',
        dbUser: config.user || config.username || '',
        dbSchema: config.schema || 'public',
        dbSsl: Boolean(config.ssl),
      };
    case 'mysql':
      return {
        dbHost: config.host || '',
        dbPort: config.port != null ? String(config.port) : '3306',
        dbDatabase: config.database || '',
        dbUser: config.user || config.username || '',
        dbSsl: Boolean(config.ssl),
      };
    case 'bigquery':
      return {
        dbProjectId: config.projectId || '',
        dbDatasetId: config.datasetId || '',
      };
    case 'snowflake':
      return {
        dbSnowflakeAccount: config.account || '',
        dbDatabase: config.database || '',
        dbSchema: config.schema || '',
        dbSnowflakeWarehouse: config.warehouse || '',
        dbUser: config.user || config.username || '',
        dbSnowflakeAuthMode: 'password',
      };
    case 'redshift':
      if ((config.redshiftType || 'redshift') === 'redshift_iam') {
        return {
          dbRedshiftAuthMode: 'redshift_iam',
          dbClusterIdentifier: config.clusterIdentifier || '',
          dbDatabase: config.database || '',
          dbUser: config.user || config.username || '',
          dbAwsRegion: config.awsRegion || '',
        };
      }
      return {
        dbRedshiftAuthMode: 'redshift',
        dbHost: config.host || '',
        dbPort: config.port != null ? String(config.port) : '5439',
        dbDatabase: config.database || '',
        dbUser: config.user || config.username || '',
        dbSchema: config.schema || 'public',
      };
    case 'trino':
      return {
        dbHost: config.host || '',
        dbPort: config.port != null ? String(config.port) : '8080',
        dbTrinoSchemas: config.schemas || '',
        dbUser: config.username || config.user || '',
        dbSsl: Boolean(config.ssl),
      };
    default:
      return {};
  }
};

const parsePositiveInteger = (value: string, field: string) => {
  const normalized = value.trim();
  const parsed = Number.parseInt(normalized, 10);

  if (!normalized || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${field} 必须是正整数`);
  }

  return parsed;
};

export const buildSecretReencryptPayload = ({
  targetKeyVersionText,
  sourceKeyVersionText,
  scopeType,
  execute,
}: {
  targetKeyVersionText: string;
  sourceKeyVersionText?: string;
  scopeType?: string;
  execute?: boolean;
}): SecretReencryptPayload => {
  const payload: SecretReencryptPayload = {
    targetKeyVersion: parsePositiveInteger(
      targetKeyVersionText,
      '目标 key version',
    ),
    execute: Boolean(execute),
  };

  const normalizedSourceKeyVersion = sourceKeyVersionText?.trim();
  if (normalizedSourceKeyVersion) {
    payload.sourceKeyVersion = parsePositiveInteger(
      normalizedSourceKeyVersion,
      '源 key version',
    );
  }

  const normalizedScopeType = scopeType?.trim();
  if (normalizedScopeType) {
    payload.scopeType = normalizedScopeType;
  }

  return payload;
};

export const buildConnectorSubmitPayload = ({
  values,
  editing,
  preserveExistingSecret,
}: {
  values: ConnectorFormValues;
  editing: boolean;
  preserveExistingSecret?: boolean;
}): ConnectorSubmitPayload => {
  const isDatabase = values.type === 'database';
  const config =
    isDatabase && hasStructuredDatabaseConfigInput(values)
      ? buildDatabaseConnectorConfig(values)
      : parseOptionalJsonObject(values.configText);

  if (isDatabase && !config) {
    throw new Error('数据库连接配置不能为空');
  }

  const payload: ConnectorSubmitPayload = {
    type: values.type,
    ...(isDatabase
      ? { databaseProvider: values.databaseProvider?.trim() || null }
      : {}),
    displayName: values.displayName.trim(),
    config,
  };

  if (editing && values.clearSecret) {
    payload.secret = null;
    return payload;
  }

  const secret =
    isDatabase && hasStructuredDatabaseSecretInput(values)
      ? buildDatabaseConnectorSecret(values)
      : parseOptionalJsonObject(values.secretText);

  if (isDatabase && isDatabaseSecretRequired(values) && !secret) {
    if (!editing || !preserveExistingSecret) {
      throw new Error('数据库密钥不能为空');
    }
  }

  const secretText = values.secretText?.trim();
  if (
    isDatabase
      ? !editing || !preserveExistingSecret || Boolean(secret)
      : !editing || secretText
  ) {
    payload.secret = secret ?? null;
  }

  return payload;
};

export const buildConnectorTestPayload = ({
  values,
  editingConnectorId,
  preserveExistingSecret,
}: {
  values: Partial<ConnectorFormValues> & {
    type: string;
    databaseProvider?: string;
    clearSecret?: boolean;
  };
  editingConnectorId?: string | null;
  preserveExistingSecret?: boolean;
}): ConnectorTestPayload => {
  const isDatabase = values.type === 'database';
  const config =
    isDatabase && hasStructuredDatabaseConfigInput(values)
      ? buildDatabaseConnectorConfig(values as ConnectorFormValues)
      : parseOptionalJsonObject(values.configText);

  if (isDatabase && !config) {
    throw new Error('数据库连接配置不能为空');
  }

  const payload: ConnectorTestPayload = {
    type: values.type,
    ...(isDatabase
      ? { databaseProvider: values.databaseProvider?.trim() || null }
      : {}),
    config,
  };

  if (editingConnectorId) {
    payload.connectorId = editingConnectorId;
  }

  if (values.clearSecret) {
    payload.secret = null;
    return payload;
  }

  const secret =
    isDatabase &&
    hasStructuredDatabaseSecretInput(values as ConnectorFormValues)
      ? buildDatabaseConnectorSecret(values as ConnectorFormValues)
      : parseOptionalJsonObject(values.secretText);

  if (
    isDatabase &&
    isDatabaseSecretRequired(values as ConnectorFormValues) &&
    !secret &&
    (!editingConnectorId || !preserveExistingSecret)
  ) {
    throw new Error('数据库密钥不能为空');
  }

  const secretText = values.secretText?.trim();
  if (
    isDatabase
      ? !editingConnectorId || !preserveExistingSecret || Boolean(secret)
      : !editingConnectorId || !preserveExistingSecret || secretText
  ) {
    payload.secret = secret ?? null;
  }

  return payload;
};
