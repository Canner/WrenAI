import axios, { AxiosResponse } from 'axios';

import { getLogger } from '@server/utils/logger';
import { DataSourceName } from '@server/types';
import { Manifest } from '@server/mdl/type';
import * as Errors from '@server/utils/error';
import { getConfig } from '@server/config';
import { toDockerHost } from '@server/utils';
import {
  CompactColumn,
  CompactTable,
  DEFAULT_PREVIEW_LIMIT,
  RecommendConstraint,
} from '@server/services';
import { snakeCase } from 'lodash';
import { WREN_AI_CONNECTION_INFO } from '../repositories';
import {
  toIbisConnectionInfo,
  toMultipleIbisConnectionInfos,
} from '../dataSource';
import { DialectSQL, WrenSQL } from '../models/adaptor';

export type { WrenSQL };

const logger = getLogger('IbisAdaptor');
logger.level = 'debug';

const config = getConfig();

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
  credentials: string; // base64 encoded
}

export interface IbisTrinoConnectionInfo {
  host: string;
  port: number;
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
  aws_access_key_id: string;
  aws_secret_access_key: string;
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

export type IbisRedshiftConnectionInfo =
  | IbisRedshiftPasswordAuth
  | IbisRedshiftIAMAuth;

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
}

const dataSourceUrlMap: Record<SupportedDataSource, string> = {
  [SupportedDataSource.POSTGRES]: 'postgres',
  [SupportedDataSource.BIG_QUERY]: 'bigquery',
  [SupportedDataSource.SNOWFLAKE]: 'snowflake',
  [SupportedDataSource.MYSQL]: 'mysql',
  [SupportedDataSource.ORACLE]: 'oracle',
  [SupportedDataSource.MSSQL]: 'mssql',
  [SupportedDataSource.CLICK_HOUSE]: 'clickhouse',
  [SupportedDataSource.TRINO]: 'trino',
  [SupportedDataSource.ATHENA]: 'athena',
  [SupportedDataSource.REDSHIFT]: 'redshift',
};

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
  // TODO: replace sql type with WrenSQL
  sql: string;
}

export interface IIbisAdaptor {
  query: (
    // TODO: replace query type with WrenSQL
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
  ) => Promise<WrenSQL>;
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

enum IBIS_API_TYPE {
  QUERY = 'QUERY',
  DRY_RUN = 'DRY_RUN',
  DRY_PLAN = 'DRY_PLAN',
  METADATA = 'METADATA',
  VALIDATION = 'VALIDATION',
  ANALYSIS = 'ANALYSIS',
  MODEL_SUBSTITUTE = 'MODEL_SUBSTITUTE',
}

export class IbisAdaptor implements IIbisAdaptor {
  private ibisServerEndpoint: string;

  constructor({ ibisServerEndpoint }: { ibisServerEndpoint: string }) {
    this.ibisServerEndpoint = ibisServerEndpoint;
  }
  public async getNativeSql(options: IbisDryPlanOptions): Promise<string> {
    const { dataSource, mdl, sql } = options;
    const body = {
      sql,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
    };
    try {
      const res = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.DRY_PLAN)}/connector/${dataSourceUrlMap[dataSource]}/dry-plan`,
        body,
      );
      return res.data;
    } catch (e) {
      logger.debug(`Dry plan error: ${e.response?.data || e.message}`);
      this.throwError(e, 'Error during dry plan execution');
    }
  }

  public async query(
    query: string,
    options: IbisQueryOptions,
  ): Promise<IbisQueryResponse> {
    const { dataSource, mdl } = options;
    const connectionInfo = this.updateConnectionInfo(options.connectionInfo);
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const queryString = this.buildQueryString(options);
    const body = {
      sql: query,
      connectionInfo: ibisConnectionInfo,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
    };
    try {
      const res = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.QUERY)}/connector/${dataSourceUrlMap[dataSource]}/query${queryString}`,
        body,
        {
          params: {
            limit: options.limit || DEFAULT_PREVIEW_LIMIT,
          },
        },
      );
      return {
        ...res.data,
        correlationId: res.headers['x-correlation-id'],
        processTime: res.headers['x-process-time'],
        cacheHit: res.headers['x-cache-hit'] === 'true',
        cacheCreatedAt:
          res.headers['x-cache-create-at'] &&
          new Date(parseInt(res.headers['x-cache-create-at'])).toISOString(),
        cacheOverrodeAt:
          res.headers['x-cache-override-at'] &&
          new Date(parseInt(res.headers['x-cache-override-at'])).toISOString(),
        override: res.headers['x-cache-override'] === 'true',
      };
    } catch (e) {
      logger.debug(`Query error: ${e.response?.data || e.message}`);
      this.throwError(e, 'Error querying ibis server');
    }
  }

  public async dryRun(
    query: string,
    options: IbisQueryOptions,
  ): Promise<DryRunResponse> {
    const { dataSource, mdl } = options;
    const connectionInfo = this.updateConnectionInfo(options.connectionInfo);
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const body = {
      sql: query,
      connectionInfo: ibisConnectionInfo,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
    };
    logger.debug(`Dry run sql from ibis with body:`);
    try {
      const response = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.DRY_RUN)}/connector/${dataSourceUrlMap[dataSource]}/query?dryRun=true`,
        body,
      );
      logger.debug(`Ibis server Dry run success`);
      return {
        correlationId: response.headers['x-correlation-id'],
        processTime: response.headers['x-process-time'],
      };
    } catch (err) {
      logger.debug(`Dry run error: ${err.response?.data || err.message}`);
      this.throwError(err, 'Error during dry run execution');
    }
  }

  public async getTables(
    dataSource: DataSourceName,
    connectionInfo: WREN_AI_CONNECTION_INFO,
  ): Promise<CompactTable[]> {
    try {
      const getTablesByConnectionInfo = async (ibisConnectionInfo) => {
        const body = {
          connectionInfo: ibisConnectionInfo,
        };
        logger.debug(`Getting tables from ibis`);
        const res: AxiosResponse<CompactTable[]> = await axios.post(
          `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.METADATA)}/connector/${dataSourceUrlMap[dataSource]}/metadata/tables`,
          body,
        );

        return this.transformDescriptionToProperties(res.data);
      };

      connectionInfo = this.updateConnectionInfo(connectionInfo);

      // If the dataSource supports multiple connection info, we need to get tables from each connection info
      const multipleIbisConnectionInfos = toMultipleIbisConnectionInfos(
        dataSource,
        connectionInfo,
      );
      if (multipleIbisConnectionInfos) {
        const results = await Promise.all(
          multipleIbisConnectionInfos.map(getTablesByConnectionInfo),
        );
        return results.flat();
      }

      // If the dataSource does not support multiple connection info, we only need to get tables from one connection info
      const ibisConnectionInfo = toIbisConnectionInfo(
        dataSource,
        connectionInfo,
      );
      return await getTablesByConnectionInfo(ibisConnectionInfo);
    } catch (e) {
      logger.debug(`Get tables error: ${e.response?.data || e.message}`);
      this.throwError(e, 'Error getting table from ibis server');
    }
  }

  public async getConstraints(
    dataSource: DataSourceName,
    connectionInfo: WREN_AI_CONNECTION_INFO,
  ): Promise<RecommendConstraint[]> {
    connectionInfo = this.updateConnectionInfo(connectionInfo);
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const body = {
      connectionInfo: ibisConnectionInfo,
    };
    try {
      logger.debug(`Getting constraint from ibis`);
      const res: AxiosResponse<RecommendConstraint[]> = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.METADATA)}/connector/${dataSourceUrlMap[dataSource]}/metadata/constraints`,
        body,
      );
      return res.data;
    } catch (e) {
      logger.debug(`Get constraints error: ${e.response?.data || e.message}`);
      this.throwError(e, 'Error getting constraint from ibis server');
    }
  }

  public async validate(
    dataSource: DataSourceName,
    validationRule: ValidationRules,
    connectionInfo: WREN_AI_CONNECTION_INFO,
    mdl: Manifest,
    parameters: Record<string, any>,
  ): Promise<ValidationResponse> {
    connectionInfo = this.updateConnectionInfo(connectionInfo);
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const body = {
      connectionInfo: ibisConnectionInfo,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
      parameters,
    };
    try {
      logger.debug(`Run validation rule "${validationRule}" with ibis`);
      await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.VALIDATION)}/connector/${dataSourceUrlMap[dataSource]}/validate/${snakeCase(validationRule)}`,
        body,
      );
      return { valid: true, message: null };
    } catch (e) {
      logger.debug(`Validation error: ${e.response?.data || e.message}`);
      return { valid: false, message: e.response?.data || e.message };
    }
  }

  public async modelSubstitute(
    sql: DialectSQL,
    options: {
      dataSource: DataSourceName;
      connectionInfo: WREN_AI_CONNECTION_INFO;
      mdl: Manifest;
      catalog?: string;
      schema?: string;
    },
  ): Promise<WrenSQL> {
    const { dataSource, mdl, catalog, schema } = options;
    let connectionInfo = options.connectionInfo;
    connectionInfo = this.updateConnectionInfo(connectionInfo);
    const headers = {
      'X-User-CATALOG': catalog,
      'X-User-SCHEMA': schema,
    };
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const body = {
      sql,
      connectionInfo: ibisConnectionInfo,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
    };
    try {
      logger.debug(`Running model substitution with ibis`);
      const res = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.MODEL_SUBSTITUTE)}/connector/${dataSourceUrlMap[dataSource]}/model-substitute`,
        body,
        {
          headers,
        },
      );
      return res.data as WrenSQL;
    } catch (e) {
      logger.debug(
        `Model substitution error: ${e.response?.data || e.message}`,
      );
      this.throwError(
        e,
        'Error running model substitution with ibis server',
        this.modelSubstituteErrorMessageBuilder,
      );
    }
  }

  public async getVersion(
    dataSource: DataSourceName,
    connectionInfo: WREN_AI_CONNECTION_INFO,
  ): Promise<string> {
    connectionInfo = this.updateConnectionInfo(connectionInfo);
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const body = {
      connectionInfo: ibisConnectionInfo,
    };
    try {
      logger.debug(`Getting version from ibis`);
      const res: AxiosResponse<string> = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.METADATA)}/connector/${dataSourceUrlMap[dataSource]}/metadata/version`,
        body,
      );
      return res.data;
    } catch (e) {
      logger.debug(`Get version error: ${e.response?.data || e.message}`);
      this.throwError(e, 'Error getting version from ibis server');
    }
  }

  private updateConnectionInfo(connectionInfo: any) {
    if (
      config.otherServiceUsingDocker &&
      Object.hasOwnProperty.call(connectionInfo, 'host')
    ) {
      connectionInfo.host = toDockerHost(connectionInfo.host);
      logger.debug(`Host replaced with docker host`);
    }
    return connectionInfo;
  }

  private transformDescriptionToProperties(
    tables: CompactTable[],
  ): CompactTable[] {
    const handleColumnProperties = (column: CompactColumn): CompactColumn => {
      const properties = column?.properties || {};
      if (column.description) {
        properties.description = column.description;
      }
      const nestedColumns = column.nestedColumns?.map((nc) => {
        return handleColumnProperties(nc);
      });
      return { ...column, properties, nestedColumns };
    };

    return tables.map((table) => {
      try {
        const properties = table?.properties || {};
        if (table.description) {
          properties.description = table.description;
        }
        if (table.columns) {
          const transformedColumns = table.columns.map((column) =>
            handleColumnProperties(column),
          );
          table.columns = transformedColumns;
        }
        return { ...table, properties };
      } catch (e) {
        console.log('e', e);
      }
    });
  }

  private getIbisApiVersion(apiType: IBIS_API_TYPE) {
    if (!config.experimentalEngineRustVersion) {
      return 'v2';
    }
    const useV3 = [
      IBIS_API_TYPE.QUERY,
      IBIS_API_TYPE.DRY_RUN,
      IBIS_API_TYPE.DRY_PLAN,
      IBIS_API_TYPE.VALIDATION,
      IBIS_API_TYPE.MODEL_SUBSTITUTE,
    ].includes(apiType);
    if (useV3) logger.debug('Using ibis v3 api');
    return useV3 ? 'v3' : 'v2';
  }

  private throwError(
    e: any,
    defaultMessage: string,
    errorMessageBuilder?: CallableFunction,
  ) {
    const customMessage =
      e.response?.data?.message ||
      e.response?.data ||
      e.message ||
      defaultMessage;

    const errorData = e.response?.data;
    throw Errors.create(Errors.GeneralErrorCodes.IBIS_SERVER_ERROR, {
      customMessage: errorMessageBuilder
        ? errorMessageBuilder(customMessage)
        : customMessage,
      originalError: e,
      other: {
        correlationId: e.response?.headers['x-correlation-id'],
        processTime: e.response?.headers['x-process-time'],
        ...errorData,
      },
    });
  }

  private modelSubstituteErrorMessageBuilder(message: string) {
    const ModelSubstituteErrorEnum = {
      MODEL_NOT_FOUND: () => {
        return message.includes('Model not found');
      },
      PARSING_EXCEPTION: () => {
        return message.includes('sql.parser.ParsingException');
      },
    };
    if (ModelSubstituteErrorEnum.MODEL_NOT_FOUND()) {
      const modelName = message.split(': ')[1];
      const dotCount = modelName.split('.').length - 1;
      switch (dotCount) {
        case 0:
          return (
            message +
            `. Try adding both catalog and schema before your table name. e.g. my_database.public.${modelName}`
          );
        case 1:
          return (
            message +
            `. Try adding the catalog before the schema in your table name. e.g. my_database.${modelName}`
          );
        case 2:
          return (
            message +
            `. It may be missing from models, misnamed, or have a case mismatch.`
          );
        default:
          return (
            message +
            `. It may be missing from models, misnamed, or have a case mismatch.`
          );
      }
    } else if (ModelSubstituteErrorEnum.PARSING_EXCEPTION()) {
      return (
        message +
        '. Please check your selected column and make sure its quoted for columns with non-alphanumeric characters.'
      );
    }
    return message;
  }

  private buildQueryString(options: IbisQueryOptions) {
    if (!options.cacheEnabled) {
      return '';
    }
    const queryString = [];
    queryString.push('cacheEnable=true');
    if (options.refresh) {
      queryString.push('overrideCache=true');
    }
    return `?${queryString.join('&')}`;
  }
}
