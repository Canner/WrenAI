import type {
  ConnectorFormValues,
  ConnectorSubmitPayload,
  ConnectorTestPayload,
  ConnectorView,
  SecretReencryptPayload,
} from './connectorsPageUtils';

type DatabaseConnectorFormShape = Partial<ConnectorFormValues> & {
  databaseProvider?: string;
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

const parsePositiveInteger = (value: string, field: string) => {
  const normalized = value.trim();
  const parsed = Number.parseInt(normalized, 10);

  if (!normalized || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${field} 必须是正整数`);
  }

  return parsed;
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

export const stringifyJson = (value?: Record<string, any> | null) =>
  value ? JSON.stringify(value, null, 2) : '';

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
