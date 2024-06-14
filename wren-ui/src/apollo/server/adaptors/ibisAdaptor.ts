import axios, { AxiosResponse } from 'axios';

import { getLogger } from '@server/utils/logger';
import { DataSourceName } from '@server/types';
import { Manifest } from '@server/mdl/type';
import * as Errors from '@server/utils/error';
import { getConfig } from '@server/config';
import { toDockerHost } from '@server/utils';
import { CompactTable, RecommendConstraint } from '@server/services';
import { snakeCase } from 'lodash';

const logger = getLogger('IbisAdaptor');
logger.level = 'debug';

const config = getConfig();

export interface IbisPostgresConnectionInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface IbisBigQueryConnectionInfo {
  project_id: string;
  dataset_id: string;
  credentials: string; // base64 encoded
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

export interface IbisQueryOptions {
  dataSource: DataSourceName;
  connectionInfo: IbisBigQueryConnectionInfo | IbisPostgresConnectionInfo;
  mdl: Manifest;
}

export interface IIbisAdaptor {
  query: (
    query: string,
    options: IbisQueryOptions,
  ) => Promise<IbisQueryResponse>;
  dryRun: (query: string, options: IbisQueryOptions) => Promise<boolean>;
  getTables: (
    dataSource: DataSourceName,
    connectionInfo: IbisBigQueryConnectionInfo | IbisPostgresConnectionInfo,
  ) => Promise<CompactTable[]>;
  getConstraints: (
    dataSource: DataSourceName,
    connectionInfo: IbisBigQueryConnectionInfo | IbisPostgresConnectionInfo,
  ) => Promise<RecommendConstraint[]>;

  validate: (
    dataSource: DataSourceName,
    rule: ValidationRules,
    connectionInfo: IbisBigQueryConnectionInfo | IbisPostgresConnectionInfo,
    mdl: Manifest,
    parameters: Record<string, any>,
  ) => Promise<ValidationResponse>;
}

export enum SupportedDataSource {
  POSTGRES = 'POSTGRES',
  BIG_QUERY = 'BIG_QUERY',
  SNOWFLAKE = 'SNOWFLAKE',
}

export interface IbisQueryResponse {
  columns: string[];
  data: any[];
  dtypes: Record<string, string>;
}

const dataSourceUrlMap: Record<SupportedDataSource, string> = {
  [SupportedDataSource.POSTGRES]: 'postgres',
  [SupportedDataSource.BIG_QUERY]: 'bigquery',
  [SupportedDataSource.SNOWFLAKE]: 'snowflake',
};

export class IbisAdaptor implements IIbisAdaptor {
  private ibisServerEndpoint: string;

  constructor({ ibisServerEndpoint }: { ibisServerEndpoint: string }) {
    this.ibisServerEndpoint = ibisServerEndpoint;
  }

  public async query(
    query: string,
    options: IbisQueryOptions,
  ): Promise<IbisQueryResponse> {
    const { dataSource, mdl } = options;
    const connectionInfo = this.updateConnectionInfo(options.connectionInfo);
    const body = {
      sql: query,
      connectionInfo,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
    };
    logger.debug(`Querying ibis with body: ${JSON.stringify(body, null, 2)}`);
    try {
      const res = await axios.post(
        `${this.ibisServerEndpoint}/v2/ibis/${dataSourceUrlMap[dataSource]}/query`,
        body,
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
    const body = {
      sql: query,
      connectionInfo,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
    };
    logger.debug(`Dry run ibis with body: ${JSON.stringify(body, null, 2)}`);
    try {
      await axios.post(
        `${this.ibisServerEndpoint}/v2/ibis/${dataSourceUrlMap[dataSource]}/query?dryRun=true`,
        body,
      );
      logger.debug(`Ibis server Dry run success`);
      return true;
    } catch (err) {
      logger.debug(`Got error when dry running ibis: ${err.response.data}`);
      throw Errors.create(Errors.GeneralErrorCodes.DRY_RUN_ERROR, {
        customMessage: err.response.data,
        originalError: err,
      });
    }
  }

  public async getTables(
    dataSource: DataSourceName,
    connectionInfo: Record<string, any>,
  ): Promise<CompactTable[]> {
    if (config.otherServiceUsingDocker) {
      connectionInfo.host = toDockerHost(connectionInfo.host);
      logger.debug(`Rewritten host: ${connectionInfo.host}`);
    }
    const body = {
      connectionInfo,
    };
    logger.debug(`Getting table with body: ${JSON.stringify(body, null, 2)}`);
    try {
      const res: AxiosResponse<CompactTable[]> = await axios.post(
        `${this.ibisServerEndpoint}/v2/ibis/${dataSourceUrlMap[dataSource]}/metadata/tables`,
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
    connectionInfo: Record<string, any>,
  ): Promise<RecommendConstraint[]> {
    if (config.otherServiceUsingDocker) {
      connectionInfo.host = toDockerHost(connectionInfo.host);
      logger.debug(`Rewritten host: ${connectionInfo.host}`);
    }
    const body = {
      connectionInfo,
    };
    logger.debug(
      `Getting constraint with body: ${JSON.stringify(body, null, 2)}`,
    );
    try {
      const res: AxiosResponse<RecommendConstraint[]> = await axios.post(
        `${this.ibisServerEndpoint}/v2/ibis/${dataSourceUrlMap[dataSource]}/metadata/constraints`,
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
    connectionInfo: Record<string, any>,
    mdl: Manifest,
    parameters: Record<string, any>,
  ): Promise<ValidationResponse> {
    if (config.otherServiceUsingDocker) {
      connectionInfo.host = toDockerHost(connectionInfo.host);
      logger.debug(`Rewritten host: ${connectionInfo.host}`);
    }
    const body = {
      connectionInfo,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
      parameters,
    };
    logger.debug(
      `Validating connection with body: ${JSON.stringify(body, null, 2)}`,
    );
    try {
      await axios.post(
        `${this.ibisServerEndpoint}/v2/ibis/${dataSourceUrlMap[dataSource]}/validate/${snakeCase(validationRule)}`,
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
      logger.debug(`Rewritten host: ${connectionInfo.host}`);
    }
    return connectionInfo;
  }
}
