import axios, { AxiosResponse } from 'axios';

import { getLogger } from '@server/utils/logger';
import { DataSourceName } from '@server/types';
import { Manifest } from '@server/mdl/type';
import * as Errors from '@server/utils/error';
import { getConfig } from '@server/config';
import { toDockerHost } from '@server/utils';
import { CompactTable, RecommendConstraint } from '@server/services';

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

export interface ConstraintResponse {
  constraints: RecommendConstraint[];
}

export interface IIbisAdaptor {
  query: (
    query: string,
    dataSource: DataSourceName,
    connectionInfo: IbisBigQueryConnectionInfo | IbisPostgresConnectionInfo,
    mdl: Manifest,
  ) => Promise<IbisQueryResponse>;
  getTables: (
    dataSource: DataSourceName,
    connectionInfo: IbisBigQueryConnectionInfo | IbisPostgresConnectionInfo,
  ) => Promise<TableResponse>;
  getConstraints: (
    dataSource: DataSourceName,
    connectionInfo: IbisBigQueryConnectionInfo | IbisPostgresConnectionInfo,
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

  async getTables(
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

  async getConstraints(
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
