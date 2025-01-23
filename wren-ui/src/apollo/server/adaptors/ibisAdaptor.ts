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
  password: string;
  account: string;
  database: string;
  schema: string;
}

export type IbisConnectionInfo =
  | UrlBasedConnectionInfo
  | HostBasedConnectionInfo
  | IbisPostgresConnectionInfo
  | IbisBigQueryConnectionInfo
  | IbisTrinoConnectionInfo
  | IbisSnowflakeConnectionInfo;

export enum SupportedDataSource {
  POSTGRES = 'POSTGRES',
  BIG_QUERY = 'BIG_QUERY',
  SNOWFLAKE = 'SNOWFLAKE',
  MYSQL = 'MYSQL',
  MSSQL = 'MSSQL',
  CLICK_HOUSE = 'CLICK_HOUSE',
  TRINO = 'TRINO',
}

const dataSourceUrlMap: Record<SupportedDataSource, string> = {
  [SupportedDataSource.POSTGRES]: 'postgres',
  [SupportedDataSource.BIG_QUERY]: 'bigquery',
  [SupportedDataSource.SNOWFLAKE]: 'snowflake',
  [SupportedDataSource.MYSQL]: 'mysql',
  [SupportedDataSource.MSSQL]: 'mssql',
  [SupportedDataSource.CLICK_HOUSE]: 'clickhouse',
  [SupportedDataSource.TRINO]: 'trino',
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
}

export interface IbisResponse {
  correlationId?: string;
  processTime?: string;
}

export interface IbisQueryResponse extends IbisResponse {
  columns: string[];
  data: any[];
  dtypes: Record<string, string>;
}

export interface DryRunResponse extends IbisResponse {}

enum IBIS_API_TYPE {
  QUERY = 'QUERY',
  DRY_RUN = 'DRY_RUN',
  DRY_PLAN = 'DRY_PLAN',
  METADATA = 'METADATA',
  VALIDATION = 'VALIDATION',
  ANALYSIS = 'ANALYSIS',
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
      logger.debug(`Got error when dry plan with ibis: ${e.response.data}`);
      throw Errors.create(Errors.GeneralErrorCodes.DRY_PLAN_ERROR, {
        customMessage: e.response.data,
        originalError: e,
      });
    }
  }

  public async query(
    query: string,
    options: IbisQueryOptions,
  ): Promise<IbisQueryResponse> {
    const { dataSource, mdl } = options;
    const connectionInfo = this.updateConnectionInfo(options.connectionInfo);
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const body = {
      sql: query,
      connectionInfo: ibisConnectionInfo,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
    };
    try {
      const res = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.QUERY)}/connector/${dataSourceUrlMap[dataSource]}/query`,
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
      };
    } catch (e) {
      logger.debug(
        `Got error when querying ibis: ${e.response?.data || e.message}`,
      );

      throw Errors.create(Errors.GeneralErrorCodes.IBIS_SERVER_ERROR, {
        customMessage:
          e.response?.data || e.message || 'Error querying ibis server',
        originalError: e,
        other: {
          correlationId: e.response?.headers['x-correlation-id'],
          processTime: e.response?.headers['x-process-time'],
        },
      });
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
      logger.info(`Got error when dry running ibis`);
      throw Errors.create(Errors.GeneralErrorCodes.DRY_RUN_ERROR, {
        customMessage: err.response?.data || err.message,
        originalError: err,
        other: {
          correlationId: err.response?.headers['x-correlation-id'],
          processTime: err.response?.headers['x-process-time'],
        },
      });
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
      logger.debug(
        `Got error when getting table: ${e.response?.data || e.message}`,
      );
      throw Errors.create(Errors.GeneralErrorCodes.IBIS_SERVER_ERROR, {
        customMessage:
          e.response?.data ||
          e.message ||
          'Error getting table from ibis server',
        originalError: e,
      });
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
      logger.debug(
        `Got error when getting constraint: ${e.response?.data || e.message}`,
      );

      throw Errors.create(Errors.GeneralErrorCodes.IBIS_SERVER_ERROR, {
        customMessage:
          e.response?.data ||
          e.message ||
          'Error getting constraint from ibis server',
        originalError: e,
      });
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
      logger.debug(
        `Got error when validating connection: ${e.response?.data || e.message}`,
      );

      return { valid: false, message: e.response?.data || e.message };
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
    ].includes(apiType);
    if (useV3) logger.debug('Using ibis v3 api');
    return useV3 ? 'v3' : 'v2';
  }
}
