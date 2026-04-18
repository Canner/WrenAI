import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { Path } from '@/utils/enum';
import { getConnectorScopeRestrictionReason } from '@/utils/workspaceGovernance';

const { Paragraph, Text } = Typography;

type ConnectorView = {
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

type ConnectorFormValues = {
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

type ConnectorSubmitPayload = {
  type: string;
  databaseProvider?: string | null;
  displayName: string;
  config: Record<string, any> | null;
  secret?: Record<string, any> | null;
};

type ConnectorTestPayload = {
  connectorId?: string;
  type: string;
  databaseProvider?: string | null;
  config: Record<string, any> | null;
  secret?: Record<string, any> | null;
};

type ConnectorTestResponse = {
  success: boolean;
  message: string;
  tableCount?: number;
  sampleTables?: string[];
  version?: string | null;
};

type SecretReencryptSummary = {
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

type SecretReencryptPayload = {
  targetKeyVersion: number;
  sourceKeyVersion?: number;
  scopeType?: string;
  execute?: boolean;
};

export const buildConnectorsCollectionUrl = (
  selector?: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl('/api/v1/connectors', {}, selector);

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

const SNOWFLAKE_AUTH_MODE_OPTIONS = [
  { label: 'Password', value: 'password' },
  { label: 'Private Key', value: 'privateKey' },
];

const REDSHIFT_AUTH_MODE_OPTIONS = [
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

const DATABASE_PROVIDER_EXAMPLES: Record<
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

const stringifyJson = (value?: Record<string, any> | null) =>
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

const getDatabaseConnectorFormValues = (
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

export default function ManageConnectors() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = Boolean(
    authSession.data?.authorization?.actor?.platformRoleKeys?.includes(
      'platform_admin',
    ) ||
      authSession.data?.authorization?.actor?.isPlatformAdmin ||
      authSession.data?.isPlatformAdmin,
  );
  const [form] = Form.useForm<ConnectorFormValues>();
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testingConnectorId, setTestingConnectorId] = useState<string | null>(
    null,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConnector, setEditingConnector] =
    useState<ConnectorView | null>(null);
  const [clearSecretChecked, setClearSecretChecked] = useState(false);
  const [secretOpsModalOpen, setSecretOpsModalOpen] = useState(false);
  const [targetKeyVersionText, setTargetKeyVersionText] = useState('2');
  const [sourceKeyVersionText, setSourceKeyVersionText] = useState('');
  const [secretScopeType, setSecretScopeType] = useState('connector');
  const [secretReencryptSubmittingMode, setSecretReencryptSubmittingMode] =
    useState<'dry-run' | 'execute' | null>(null);
  const [secretReencryptSummary, setSecretReencryptSummary] =
    useState<SecretReencryptSummary | null>(null);
  const workspaceScopedSelector = useMemo(
    () =>
      resolveConnectorWorkspaceSelector({
        runtimeSelector: runtimeScopeNavigation.selector,
        sessionWorkspaceId: authSession.data?.workspace?.id,
        actorWorkspaceId: authSession.data?.authorization?.actor?.workspaceId,
      }),
    [
      authSession.data?.authorization?.actor?.workspaceId,
      authSession.data?.workspace?.id,
      runtimeScopeNavigation.selector?.workspaceId,
    ],
  );
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

  const connectorTypeOptions = useMemo(() => CONNECTOR_TYPE_OPTIONS, []);
  const configuredSecretCount = useMemo(
    () => connectors.filter((connector) => connector.hasSecret).length,
    [connectors],
  );
  const connectorScopeRestrictionReason = useMemo(
    () =>
      getConnectorScopeRestrictionReason({
        workspaceKind: authSession.data?.workspace?.kind,
        knowledgeBaseKind: null,
      }),
    [authSession.data?.workspace?.kind],
  );
  const authorizationActions = authSession.data?.authorization?.actions || {};
  const hasAuthCapabilities = Object.keys(authorizationActions).length > 0;
  const canCreateConnector = hasAuthCapabilities
    ? Boolean(authorizationActions['connector.create'])
    : true;
  const canUpdateConnector = hasAuthCapabilities
    ? Boolean(authorizationActions['connector.update'])
    : true;
  const canDeleteConnector = hasAuthCapabilities
    ? Boolean(authorizationActions['connector.delete'])
    : true;
  const canRotateConnectorSecret = hasAuthCapabilities
    ? Boolean(authorizationActions['connector.rotate_secret'])
    : true;
  const connectorPermissionBlockedReason =
    canCreateConnector ||
    canUpdateConnector ||
    canDeleteConnector ||
    canRotateConnectorSecret
      ? null
      : '当前账号没有连接器管理权限';
  const connectorActionBlockedReason =
    connectorScopeRestrictionReason || connectorPermissionBlockedReason;
  const createConnectorBlockedReason = connectorScopeRestrictionReason
    ? connectorScopeRestrictionReason
    : canCreateConnector
      ? null
      : '当前账号没有创建连接器权限';
  const updateConnectorBlockedReason = connectorScopeRestrictionReason
    ? connectorScopeRestrictionReason
    : canUpdateConnector
      ? null
      : '当前账号没有编辑或测试连接器权限';
  const deleteConnectorBlockedReason = connectorScopeRestrictionReason
    ? connectorScopeRestrictionReason
    : canDeleteConnector
      ? null
      : '当前账号没有删除连接器权限';
  const rotateConnectorSecretBlockedReason = connectorScopeRestrictionReason
    ? connectorScopeRestrictionReason
    : canRotateConnectorSecret
      ? null
      : '当前账号没有批量轮换密钥权限';

  const requireWorkspaceSelector = () => {
    if (!workspaceScopedSelector?.workspaceId) {
      throw new Error('当前工作空间未就绪，请稍后重试。');
    }

    return workspaceScopedSelector;
  };

  const loadConnectors = async () => {
    if (
      !runtimeScopePage.hasRuntimeScope ||
      !workspaceScopedSelector?.workspaceId
    ) {
      setConnectors([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        buildConnectorsCollectionUrl(requireWorkspaceSelector()),
      );
      if (!response.ok) {
        throw new Error(`加载连接器失败：${response.status}`);
      }

      const payload = await response.json();
      setConnectors(Array.isArray(payload) ? payload : []);
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载连接器失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
      setConnectors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (
      !runtimeScopePage.hasRuntimeScope ||
      !workspaceScopedSelector?.workspaceId
    ) {
      return;
    }
    void loadConnectors();
  }, [runtimeScopePage.hasRuntimeScope, workspaceScopedSelector?.workspaceId]);

  const openCreateModal = () => {
    if (createConnectorBlockedReason) {
      message.info(createConnectorBlockedReason);
      return;
    }
    setEditingConnector(null);
    setClearSecretChecked(false);
    form.resetFields();
    form.setFieldsValue({ type: 'rest_json' });
    setModalOpen(true);
  };

  const openEditModal = (connector: ConnectorView) => {
    if (updateConnectorBlockedReason) {
      message.info(updateConnectorBlockedReason);
      return;
    }
    setEditingConnector(connector);
    setClearSecretChecked(false);
    form.setFieldsValue({
      type: connector.type,
      databaseProvider: connector.databaseProvider || 'postgres',
      displayName: connector.displayName,
      configText:
        connector.type === 'database' ? '' : stringifyJson(connector.config),
      secretText: '',
      ...(connector.type === 'database'
        ? getDatabaseConnectorFormValues(connector)
        : {}),
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingConnector(null);
    setClearSecretChecked(false);
    form.resetFields();
  };

  const openSecretOpsModal = () => {
    if (rotateConnectorSecretBlockedReason) {
      message.info(rotateConnectorSecretBlockedReason);
      return;
    }
    setSecretOpsModalOpen(true);
    setSecretReencryptSummary(null);
  };

  const closeSecretOpsModal = () => {
    setSecretOpsModalOpen(false);
    setSecretReencryptSummary(null);
    setSourceKeyVersionText('');
    setTargetKeyVersionText('2');
    setSecretScopeType('connector');
  };

  const submitConnector = async () => {
    const submitBlockedReason = editingConnector
      ? updateConnectorBlockedReason
      : createConnectorBlockedReason;
    if (submitBlockedReason) {
      message.info(submitBlockedReason);
      return;
    }
    try {
      const values = await form.validateFields();
      const payload = buildConnectorSubmitPayload({
        values: {
          ...values,
          clearSecret: clearSecretChecked,
        },
        editing: Boolean(editingConnector),
        preserveExistingSecret:
          Boolean(editingConnector?.hasSecret) && !clearSecretChecked,
      });

      setSubmitting(true);
      const workspaceSelector = requireWorkspaceSelector();
      const response = await fetch(
        editingConnector
          ? buildConnectorItemUrl(editingConnector.id, workspaceSelector)
          : buildConnectorsCollectionUrl(workspaceSelector),
        {
          method: editingConnector ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || '保存连接器失败。');
      }

      message.success(editingConnector ? '连接器已更新。' : '连接器已创建。');
      closeModal();
      await loadConnectors();
    } catch (error: any) {
      if (error?.errorFields) {
        return;
      }
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '保存连接器失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const deleteConnector = async (connectorId: string) => {
    if (deleteConnectorBlockedReason) {
      message.info(deleteConnectorBlockedReason);
      return;
    }
    try {
      const response = await fetch(
        buildConnectorItemUrl(connectorId, requireWorkspaceSelector()),
        {
          method: 'DELETE',
        },
      );
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || '删除连接器失败。');
      }

      message.success('连接器已删除。');
      await loadConnectors();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '删除连接器失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    }
  };

  const executeConnectorTest = async (
    payload: ConnectorTestPayload,
  ): Promise<ConnectorTestResponse> => {
    const response = await fetch(
      buildConnectorTestUrl(requireWorkspaceSelector()),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || '连接测试失败。');
    }

    return (await response.json()) as ConnectorTestResponse;
  };

  const executeSecretReencrypt = async (
    execute: boolean,
  ): Promise<SecretReencryptSummary> => {
    const payload = buildSecretReencryptPayload({
      targetKeyVersionText,
      sourceKeyVersionText,
      scopeType: secretScopeType,
      execute,
    });

    const response = await fetch(
      buildSecretReencryptApiUrl(requireWorkspaceSelector()),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || '密钥轮换执行失败。');
    }

    return (await response.json()) as SecretReencryptSummary;
  };

  const handleModalTestConnection = async () => {
    if (updateConnectorBlockedReason) {
      message.info(updateConnectorBlockedReason);
      return;
    }
    try {
      const values = form.getFieldsValue();
      const payload = buildConnectorTestPayload({
        values: {
          ...values,
          clearSecret: clearSecretChecked,
        },
        editingConnectorId: editingConnector?.id ?? null,
        preserveExistingSecret:
          Boolean(editingConnector) && !clearSecretChecked,
      });

      if (payload.type !== 'database') {
        message.info('当前仅支持 database 连接器的连接测试。');
        return;
      }

      setTestingConnection(true);
      const result = await executeConnectorTest(payload);
      message.success(result.message || '连接测试成功。');
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '连接测试失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setTestingConnection(false);
    }
  };

  const handleTestSavedConnector = async (connector: ConnectorView) => {
    if (updateConnectorBlockedReason) {
      message.info(updateConnectorBlockedReason);
      return;
    }
    if (connector.type !== 'database') {
      message.info('当前仅支持 database 连接器的连接测试。');
      return;
    }

    try {
      setTestingConnectorId(connector.id);
      const result = await executeConnectorTest({
        connectorId: connector.id,
        type: connector.type,
        databaseProvider: connector.databaseProvider ?? null,
        config: connector.config ?? null,
      });
      message.success(result.message || '连接测试成功。');
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '连接测试失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setTestingConnectorId(null);
    }
  };

  const handleSecretReencrypt = async (execute: boolean) => {
    if (rotateConnectorSecretBlockedReason) {
      message.info(rotateConnectorSecretBlockedReason);
      return;
    }
    const mode = execute ? 'execute' : 'dry-run';
    try {
      setSecretReencryptSubmittingMode(mode);
      const summary = await executeSecretReencrypt(execute);
      setSecretReencryptSummary(summary);
      message.success(
        execute ? '密钥重加密已执行。' : '密钥重加密 dry-run 已完成。',
      );
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '密钥轮换执行失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setSecretReencryptSubmittingMode(null);
    }
  };

  if (runtimeScopePage.guarding) {
    return (
      <ConsoleShellLayout
        title="数据连接器"
        loading
        hideHeader
        contentBorderless
        navItems={buildNovaSettingsNavItems({
          activeKey: 'settingsConnectors',
          onNavigate: runtimeScopeNavigation.pushWorkspace,
          showPlatformAdmin: showPlatformManagement,
        })}
        hideHistorySection
        sidebarBackAction={{
          label: '返回主菜单',
          onClick: () => runtimeScopeNavigation.pushWorkspace(Path.Home),
        }}
      />
    );
  }

  return (
    <ConsoleShellLayout
      loading={loading || authSession.loading}
      title="数据连接器"
      hideHeader
      contentBorderless
      navItems={buildNovaSettingsNavItems({
        activeKey: 'settingsConnectors',
        onNavigate: runtimeScopeNavigation.pushWorkspace,
        showPlatformAdmin: showPlatformManagement,
      })}
      hideHistorySection
      sidebarBackAction={{
        label: '返回主菜单',
        onClick: () => runtimeScopeNavigation.pushWorkspace(Path.Home),
      }}
    >
      {connectorActionBlockedReason ? (
        <Alert
          showIcon
          type="info"
          style={{ marginBottom: 16 }}
          message={connectorActionBlockedReason}
          description={
            connectorScopeRestrictionReason
              ? '当前作用域是系统托管样例空间，仅支持浏览示例数据，不支持新增、编辑、删除或测试连接器。'
              : '当前账号只有连接器浏览权限；如需新增、编辑、测试、删除或轮换密钥，请联系工作区管理员。'
          }
        />
      ) : null}

      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <div className="console-panel-title">连接器目录</div>
            <div className="console-panel-subtitle">
              {connectors.length > 0
                ? `当前共 ${connectors.length} 个连接器，${configuredSecretCount} 个已配置密钥。`
                : '统一管理工作区可复用的 API、数据库与工具端点。'}
            </div>
          </div>
          <Space wrap>
            <Button
              onClick={openSecretOpsModal}
              disabled={Boolean(rotateConnectorSecretBlockedReason)}
            >
              批量轮换密钥
            </Button>
            <Button
              type="primary"
              onClick={openCreateModal}
              disabled={Boolean(createConnectorBlockedReason)}
            >
              添加连接器
            </Button>
          </Space>
        </div>

        <Table
          className="console-table"
          rowKey="id"
          dataSource={connectors}
          locale={{ emptyText: '暂无数据' }}
          pagination={{ hideOnSinglePage: true, pageSize: 10, size: 'small' }}
          columns={[
            {
              title: '连接器',
              dataIndex: 'displayName',
              render: (value: string, record: ConnectorView) => (
                <Space direction="vertical" size={0}>
                  <Text strong>{value}</Text>
                  <Space size={6}>
                    <Text type="secondary">{record.type}</Text>
                    {record.databaseProvider ? (
                      <Tag style={{ marginInlineEnd: 0 }}>
                        {record.databaseProvider}
                      </Tag>
                    ) : null}
                    {record.trinoCatalogName ? (
                      <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                        {record.trinoCatalogName}
                      </Tag>
                    ) : null}
                  </Space>
                </Space>
              ),
            },
            {
              title: '配置',
              dataIndex: 'config',
              render: (value: Record<string, any> | null | undefined) =>
                value ? (
                  <Paragraph ellipsis={{ rows: 3 }} className="mb-0">
                    {JSON.stringify(value)}
                  </Paragraph>
                ) : (
                  <Text type="secondary">—</Text>
                ),
            },
            {
              title: '密钥',
              dataIndex: 'hasSecret',
              width: 120,
              render: (hasSecret: boolean | undefined) =>
                hasSecret ? <Tag color="green">已配置</Tag> : <Tag>未配置</Tag>,
            },
            {
              title: '操作',
              key: 'actions',
              width: 160,
              render: (_: any, record: ConnectorView) => (
                <Space>
                  <Button
                    size="small"
                    onClick={() => openEditModal(record)}
                    disabled={Boolean(updateConnectorBlockedReason)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="small"
                    onClick={() => handleTestSavedConnector(record)}
                    loading={testingConnectorId === record.id}
                    disabled={
                      Boolean(updateConnectorBlockedReason) ||
                      record.type !== 'database'
                    }
                  >
                    测试
                  </Button>
                  <Popconfirm
                    title="确认删除这个连接器吗？"
                    onConfirm={() => deleteConnector(record.id)}
                    disabled={Boolean(deleteConnectorBlockedReason)}
                  >
                    <Button
                      size="small"
                      danger
                      disabled={Boolean(deleteConnectorBlockedReason)}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </section>

      <Modal
        title="批量轮换密钥"
        visible={secretOpsModalOpen}
        onCancel={closeSecretOpsModal}
        destroyOnClose
        footer={[
          <Button
            key="cancel"
            onClick={closeSecretOpsModal}
            disabled={Boolean(secretReencryptSubmittingMode)}
          >
            取消
          </Button>,
          <Button
            key="dry-run"
            onClick={() => handleSecretReencrypt(false)}
            loading={secretReencryptSubmittingMode === 'dry-run'}
            disabled={
              Boolean(rotateConnectorSecretBlockedReason) ||
              secretReencryptSubmittingMode === 'execute'
            }
          >
            Dry-run
          </Button>,
          <Button
            key="execute"
            type="primary"
            danger
            onClick={() => handleSecretReencrypt(true)}
            loading={secretReencryptSubmittingMode === 'execute'}
            disabled={
              Boolean(rotateConnectorSecretBlockedReason) ||
              secretReencryptSubmittingMode === 'dry-run'
            }
          >
            执行轮换
          </Button>,
        ]}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Paragraph type="secondary" className="mb-0">
            {CONNECTOR_SECRET_ROTATION_HINT}
          </Paragraph>
          <div>
            <Text strong>作用域类型</Text>
            <Select
              value={secretScopeType}
              style={{ width: '100%', marginTop: 8 }}
              options={[
                { label: 'connector', value: 'connector' },
                { label: 'skill', value: 'skill' },
              ]}
              onChange={setSecretScopeType}
            />
          </div>
          <div>
            <Text strong>目标 key version</Text>
            <Input
              value={targetKeyVersionText}
              onChange={(event) => setTargetKeyVersionText(event.target.value)}
              placeholder="例如 2"
              style={{ marginTop: 8 }}
            />
          </div>
          <div>
            <Text strong>源 key version（可选）</Text>
            <Input
              value={sourceKeyVersionText}
              onChange={(event) => setSourceKeyVersionText(event.target.value)}
              placeholder="留空表示扫描所有非目标版本"
              style={{ marginTop: 8 }}
            />
          </div>

          {secretReencryptSummary ? (
            <div
              style={{
                border: '1px solid rgba(15, 23, 42, 0.08)',
                borderRadius: 16,
                padding: 16,
              }}
            >
              <Paragraph className="mb-0">
                模式：
                {secretReencryptSummary.dryRun ? 'Dry-run' : 'Execute'} · 扫描{' '}
                {secretReencryptSummary.scanned} 条 · 可处理{' '}
                {secretReencryptSummary.eligible} 条 · 已更新{' '}
                {secretReencryptSummary.updated} 条
              </Paragraph>
              <Paragraph className="gray-7 mb-0">
                目标版本：v{secretReencryptSummary.targetKeyVersion}
                {secretReencryptSummary.filters?.sourceKeyVersion
                  ? ` · 源版本：v${secretReencryptSummary.filters.sourceKeyVersion}`
                  : ''}
                {secretReencryptSummary.filters?.scopeType
                  ? ` · 作用域：${secretReencryptSummary.filters.scopeType}`
                  : ''}
              </Paragraph>
              {secretReencryptSummary.records?.length ? (
                <Paragraph className="gray-7 mb-0" style={{ marginTop: 8 }}>
                  样例记录：
                  {secretReencryptSummary.records
                    .slice(0, 3)
                    .map(
                      (record) =>
                        `${record.scopeType}:${record.scopeId} v${record.fromKeyVersion}→v${record.toKeyVersion}`,
                    )
                    .join('；')}
                </Paragraph>
              ) : null}
            </div>
          ) : null}
        </Space>
      </Modal>

      <Modal
        title={editingConnector ? '编辑连接器' : '添加连接器'}
        visible={modalOpen}
        onCancel={closeModal}
        destroyOnClose
        footer={[
          <Button
            key="cancel"
            onClick={closeModal}
            disabled={submitting || testingConnection}
          >
            取消
          </Button>,
          <Button
            key="test"
            onClick={handleModalTestConnection}
            loading={testingConnection}
            disabled={
              Boolean(updateConnectorBlockedReason) ||
              submitting ||
              watchedConnectorType !== 'database'
            }
          >
            连接测试
          </Button>,
          <Button
            key="submit"
            type="primary"
            onClick={submitConnector}
            loading={submitting}
            disabled={Boolean(
              editingConnector
                ? updateConnectorBlockedReason
                : createConnectorBlockedReason,
            )}
          >
            保存
          </Button>,
        ]}
      >
        <Form layout="vertical" form={form}>
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
            <Paragraph type="secondary">
              数据库连接器会根据 databaseProvider
              做连接测试；进入联邦运行时时， 仅支持自动映射到 Trino 的
              provider / 鉴权方式会参与 runtime project 聚合。
            </Paragraph>
          ) : null}
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
                  <Form.Item name="dbDatabase" label="数据库名">
                    <Input placeholder="analytics" />
                  </Form.Item>
                  <Form.Item name="dbUser" label="用户名">
                    <Input placeholder="postgres" />
                  </Form.Item>
                  <Form.Item name="dbSchema" label="Schema">
                    <Input placeholder="public" />
                  </Form.Item>
                  <Form.Item
                    name="dbSsl"
                    label="启用 SSL"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item name="dbPassword" label="密码">
                    <Input
                      type="password"
                      placeholder="postgres"
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
                  <Form.Item name="dbDatabase" label="数据库名">
                    <Input placeholder="analytics" />
                  </Form.Item>
                  <Form.Item name="dbUser" label="用户名">
                    <Input placeholder="root" />
                  </Form.Item>
                  <Form.Item
                    name="dbSsl"
                    label="启用 SSL"
                    valuePropName="checked"
                  >
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

              {watchedDatabaseProvider === 'bigquery' ? (
                <>
                  <Form.Item name="dbProjectId" label="Project ID">
                    <Input placeholder="my-gcp-project" />
                  </Form.Item>
                  <Form.Item name="dbDatasetId" label="Dataset ID">
                    <Input placeholder="analytics" />
                  </Form.Item>
                  <Form.Item name="dbCredentialsText" label="Credentials JSON">
                    <Input.TextArea
                      rows={8}
                      placeholder={
                        databaseProviderExample?.secret ||
                        '{"credentials":{"type":"service_account"}}'
                      }
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
                  <Form.Item name="dbDatabase" label="数据库名">
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
                  <Form.Item name="dbSnowflakeAuthMode" label="鉴权方式">
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
                  <Form.Item name="dbRedshiftAuthMode" label="鉴权方式">
                    <Select options={REDSHIFT_AUTH_MODE_OPTIONS} />
                  </Form.Item>
                  {watchedRedshiftAuthMode === 'redshift_iam' ? (
                    <>
                      <Form.Item
                        name="dbClusterIdentifier"
                        label="Cluster Identifier"
                      >
                        <Input placeholder="redshift-cluster" />
                      </Form.Item>
                      <Form.Item name="dbDatabase" label="数据库名">
                        <Input placeholder="analytics" />
                      </Form.Item>
                      <Form.Item name="dbUser" label="用户名">
                        <Input placeholder="analyst" />
                      </Form.Item>
                      <Form.Item name="dbAwsRegion" label="AWS Region">
                        <Input placeholder="us-east-1" />
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
                      <Form.Item name="dbDatabase" label="数据库名">
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
                  <Form.Item
                    name="dbSsl"
                    label="启用 SSL"
                    valuePropName="checked"
                  >
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
                    databaseProviderExample?.secret ||
                    '{"apiKey": "secret-token"}'
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
                onChange={setClearSecretChecked}
              />
            </Form.Item>
          ) : null}
          {editingConnector ? (
            <Paragraph className="gray-7 mb-0">
              {CONNECTOR_SECRET_EDIT_HINT}
            </Paragraph>
          ) : null}
        </Form>
      </Modal>
    </ConsoleShellLayout>
  );
}
