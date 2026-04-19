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

export {
  buildConnectorSubmitPayload,
  buildConnectorTestPayload,
  buildSecretReencryptPayload,
  getDatabaseConnectorFormValues,
  stringifyJson,
} from './connectorsPayloadUtils';
