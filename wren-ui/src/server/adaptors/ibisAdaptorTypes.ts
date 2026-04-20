import { DataSourceName } from '@server/types';
import { Manifest } from '@server/mdl/type';
import { CompactTable, RecommendConstraint } from '@server/services';
import { WREN_AI_CONNECTION_INFO } from '../repositories';
import { DialectSQL } from '../models/adaptor';

export interface HostBasedConnectionInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface UrlBasedConnectionInfo {
  connectionUrl: string;
}

export type IbisPostgresConnectionInfo =
  | UrlBasedConnectionInfo
  | HostBasedConnectionInfo;

export interface IbisBigQueryConnectionInfo {
  project_id: string;
  dataset_id: string;
  credentials: string;
}

export interface IbisTrinoConnectionInfo {
  host: string;
  port: string;
  catalog: string;
  schema: string;
  user: string;
  password: string;
}

export interface IbisSnowflakeConnectionInfo {
  user: string;
  account: string;
  database: string;
  schema: string;
  password?: string;
  privateKey?: string;
  warehouse?: string;
}

export interface IbisAthenaConnectionInfo {
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  web_identity_token?: string;
  role_arn?: string;
  role_session_name?: string;
  region_name: string;
  s3_staging_dir: string;
  schema_name: string;
}

export enum IbisRedshiftConnectionType {
  REDSHIFT = 'redshift',
  REDSHIFT_IAM = 'redshift_iam',
}

interface IbisRedshiftPasswordAuth {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  redshift_type: IbisRedshiftConnectionType;
}

interface IbisRedshiftIAMAuth {
  cluster_identifier: string;
  user: string;
  database: string;
  region: string;
  access_key_id: string;
  access_key_secret: string;
  redshift_type: IbisRedshiftConnectionType;
}

export enum IbisDatabricksConnectionType {
  TOKEN = 'token',
  SERVICE_PRINCIPAL = 'service_principal',
}

interface IbisDatabricksPersonalAccessTokenAuth {
  databricks_type: IbisDatabricksConnectionType;
  serverHostname: string;
  httpPath: string;
  accessToken: string;
}

interface IbisDatabricksServicePrincipalAuth {
  databricks_type: IbisDatabricksConnectionType;
  serverHostname: string;
  httpPath: string;
  clientId: string;
  clientSecret: string;
  azureTenantId?: string;
}

export type IbisRedshiftConnectionInfo =
  | IbisRedshiftPasswordAuth
  | IbisRedshiftIAMAuth;

export type IbisDatabricksConnectionInfo =
  | IbisDatabricksPersonalAccessTokenAuth
  | IbisDatabricksServicePrincipalAuth;

export enum SupportedDataSource {
  POSTGRES = 'POSTGRES',
  BIG_QUERY = 'BIG_QUERY',
  SNOWFLAKE = 'SNOWFLAKE',
  MYSQL = 'MYSQL',
  ORACLE = 'ORACLE',
  MSSQL = 'MSSQL',
  CLICK_HOUSE = 'CLICK_HOUSE',
  TRINO = 'TRINO',
  ATHENA = 'ATHENA',
  REDSHIFT = 'REDSHIFT',
  DATABRICKS = 'DATABRICKS',
}

export interface TableResponse {
  tables: CompactTable[];
}

export enum ValidationRules {
  COLUMN_IS_VALID = 'COLUMN_IS_VALID',
}

export interface ValidationResponse {
  valid: boolean;
  message: string | null;
}

export interface IbisBaseOptions {
  dataSource: DataSourceName;
  connectionInfo: WREN_AI_CONNECTION_INFO;
  mdl: Manifest;
}
export interface IbisQueryOptions extends IbisBaseOptions {
  limit?: number;
  refresh?: boolean;
  cacheEnabled?: boolean;
}
export interface IbisDryPlanOptions {
  dataSource: DataSourceName;
  mdl: Manifest;
  sql: string;
}

export interface IIbisAdaptor {
  query: (
    query: string,
    options: IbisQueryOptions,
  ) => Promise<IbisQueryResponse>;
  dryRun: (query: string, options: IbisBaseOptions) => Promise<DryRunResponse>;
  getTables: (
    dataSource: DataSourceName,
    connectionInfo: WREN_AI_CONNECTION_INFO,
  ) => Promise<CompactTable[]>;
  getConstraints: (
    dataSource: DataSourceName,
    connectionInfo: WREN_AI_CONNECTION_INFO,
  ) => Promise<RecommendConstraint[]>;
  getNativeSql: (options: IbisDryPlanOptions) => Promise<string>;
  validate: (
    dataSource: DataSourceName,
    rule: ValidationRules,
    connectionInfo: WREN_AI_CONNECTION_INFO,
    mdl: Manifest,
    parameters: Record<string, any>,
  ) => Promise<ValidationResponse>;
  modelSubstitute: (
    sql: DialectSQL,
    options: {
      dataSource: DataSourceName;
      connectionInfo: WREN_AI_CONNECTION_INFO;
      mdl: Manifest;
      catalog?: string;
      schema?: string;
    },
  ) => Promise<any>;
  getVersion: (
    dataSource: DataSourceName,
    connectionInfo: WREN_AI_CONNECTION_INFO,
  ) => Promise<string>;
}

export interface IbisResponse {
  correlationId?: string;
  processTime?: string;
}

export interface IbisQueryResponse extends IbisResponse {
  columns: string[];
  data: any[];
  dtypes: Record<string, string>;
  cacheHit?: boolean;
  cacheCreatedAt?: string;
  cacheOverrodeAt?: string;
  override?: boolean;
}

export interface DryRunResponse extends IbisResponse {}
