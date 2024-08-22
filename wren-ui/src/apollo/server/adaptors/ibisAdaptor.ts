import axios, { AxiosResponse } from 'axios';

import { getLogger } from '@server/utils/logger';
import { DataSourceName } from '@server/types';
import { Manifest } from '@server/mdl/type';
import * as Errors from '@server/utils/error';
import { getConfig } from '@server/config';
import { toDockerHost } from '@server/utils';
import {
  CompactTable,
  DEFAULT_PREVIEW_LIMIT,
  RecommendConstraint,
} from '@server/services';
import { snakeCase } from 'lodash';
import { WREN_AI_CONNECTION_INFO } from '../repositories';
import { toIbisConnectionInfo } from '../dataSource';

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

export type IbisConnectionInfo =
  | UrlBasedConnectionInfo
  | HostBasedConnectionInfo
  | IbisPostgresConnectionInfo
  | IbisBigQueryConnectionInfo
  | IbisTrinoConnectionInfo;

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
  dryRun: (query: string, options: IbisBaseOptions) => Promise<boolean>;
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

export interface IbisQueryResponse {
  columns: string[];
  data: any[];
  dtypes: Record<string, string>;
}

export class IbisAdaptor implements IIbisAdaptor {
  private ibisServerBaseUrl: string;

  constructor({ ibisServerEndpoint }: { ibisServerEndpoint: string }) {
    this.ibisServerBaseUrl = `${ibisServerEndpoint}/v2/connector`;
  }
  public async getNativeSql(options: IbisDryPlanOptions): Promise<string> {
    const { dataSource, mdl, sql } = options;
    const body = {
      sql,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
    };
    try {
      const res = await axios.post(
        `${this.ibisServerBaseUrl}/${dataSourceUrlMap[dataSource]}/dry-plan`,
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
        `${this.ibisServerBaseUrl}/${dataSourceUrlMap[dataSource]}/query`,
        body,
        {
          params: {
            limit: options.limit || DEFAULT_PREVIEW_LIMIT,
          },
        },
      );
      const response = res.data;
      return response;
    } catch (e) {
      logger.debug(`Got error when querying ibis: ${e.response.data}`);

      throw Errors.create(Errors.GeneralErrorCodes.IBIS_SERVER_ERROR, {
        customMessage: e.response.data || 'Error querying ibis server',
        originalError: e,
      });
    }
  }

  public async dryRun(
    query: string,
    options: IbisQueryOptions,
  ): Promise<boolean> {
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
      await axios.post(
        `${this.ibisServerBaseUrl}/${dataSourceUrlMap[dataSource]}/query?dryRun=true`,
        body,
      );
      logger.debug(`Ibis server Dry run success`);
      return true;
    } catch (err) {
      logger.info(`Got error when dry running ibis`);
      throw Errors.create(Errors.GeneralErrorCodes.DRY_RUN_ERROR, {
        customMessage: err.response.data,
        originalError: err,
      });
    }
  }

  public async getTables(
    dataSource: DataSourceName,
    connectionInfo: WREN_AI_CONNECTION_INFO,
  ): Promise<CompactTable[]> {
    connectionInfo = this.updateConnectionInfo(connectionInfo);
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const body = {
      connectionInfo: ibisConnectionInfo,
    };
    try {
      logger.debug(`Getting tables from ibis`);
      const res: AxiosResponse<CompactTable[]> = await axios.post(
        `${this.ibisServerBaseUrl}/${dataSourceUrlMap[dataSource]}/metadata/tables`,
        body,
      );
      return res.data;
    } catch (e) {
      logger.debug(`Got error when getting table: ${e.response.data}`);

      throw Errors.create(Errors.GeneralErrorCodes.IBIS_SERVER_ERROR, {
        customMessage:
          e.response.data || 'Error getting table from ibis server',
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
        `${this.ibisServerBaseUrl}/${dataSourceUrlMap[dataSource]}/metadata/constraints`,
        body,
      );
      return res.data;
    } catch (e) {
      logger.debug(`Got error when getting constraint: ${e.response.data}`);

      throw Errors.create(Errors.GeneralErrorCodes.IBIS_SERVER_ERROR, {
        customMessage:
          e.response.data || 'Error getting constraint from ibis server',
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
        `${this.ibisServerBaseUrl}/${dataSourceUrlMap[dataSource]}/validate/${snakeCase(validationRule)}`,
        body,
      );
      return { valid: true, message: null };
    } catch (e) {
      logger.debug(`Got error when validating connection: ${e.response.data}`);

      return { valid: false, message: e.response.data };
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
}
