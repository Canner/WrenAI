import axios, { AxiosResponse } from 'axios';

import { getLogger } from '@server/utils/logger';
import { DataSourceName } from '../types';
import { Manifest } from '../mdl/type';
import * as Errors from '@server/utils/error';
import { getConfig } from '@server/config';
import { toDockerHost } from '../utils';

const logger = getLogger('IbisAdaptor');
logger.level = 'debug';

const config = getConfig();

export interface PostgresConnectionInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface BigQueryConnectionInfo {
  project_id: string;
  dataset_id: string;
  credentials: string; // base64 encoded
}

export interface CompactColumn {
  name: string;
  type: string;
  notNull: boolean;
  description?: string;
  properties?: Record<string, any>;
}

export interface CompactTable {
  name: string;
  columns: CompactColumn[];
  description?: string;
  properties?: Record<string, any>;
}

export interface TableResponse {
  tables: CompactTable[];
}

export enum ConstraintType {
  PRIMARY_KEY = 'PRIMARY KEY',
  FOREIGN_KEY = 'FOREIGN KEY',
  UNIQUE = 'UNIQUE',
}

export interface RecommendConstraint {
  constraint_name: string;
  constraint_type: ConstraintType;
  constraint_table: string;
  constraint_column: string;
  constrainted_table: string;
  constrainted_column: string;
}

export interface ConstraintResponse {
  constraints: RecommendConstraint[];
}

export interface IIbisAdaptor {
  query: (
    query: string,
    dataSource: DataSourceName,
    connectionInfo: BigQueryConnectionInfo | PostgresConnectionInfo,
    mdl: Manifest,
  ) => Promise<IbisQueryResponse>;
  get_table: (
    dataSource: DataSourceName,
    connectionInfo: BigQueryConnectionInfo | PostgresConnectionInfo,
  ) => Promise<TableResponse>;
  get_constraint: (
    dataSource: DataSourceName,
    connectionInfo: BigQueryConnectionInfo | PostgresConnectionInfo,
  ) => Promise<ConstraintResponse>;
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

  async query(
    query: string,
    dataSource: DataSourceName,
    connectionInfo: Record<string, any>,
    mdl: Manifest,
  ): Promise<IbisQueryResponse> {
    if (config.otherServiceUsingDocker) {
      connectionInfo.host = toDockerHost(connectionInfo.host);
      logger.debug(`Rewritten host: ${connectionInfo.host}`);
    }
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

  async get_table(
    dataSource: DataSourceName,
    connectionInfo: Record<string, any>,
  ): Promise<TableResponse> {
    if (config.otherServiceUsingDocker) {
      connectionInfo.host = toDockerHost(connectionInfo.host);
      logger.debug(`Rewritten host: ${connectionInfo.host}`);
    }
    const body = {
      connectionInfo,
    };
    logger.debug(`Getting table with body: ${JSON.stringify(body, null, 2)}`);
    try {
      const res: AxiosResponse<TableResponse> = await axios.post(
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

  async get_constraint(
    dataSource: DataSourceName,
    connectionInfo: Record<string, any>,
  ): Promise<ConstraintResponse> {
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
      const res: AxiosResponse<ConstraintResponse> = await axios.post(
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
}
