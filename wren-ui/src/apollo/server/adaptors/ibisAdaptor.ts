import axios from 'axios';

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

export interface BIGQUERYConnectionInfo {
  project_id: string;
  dataset_id: string;
  credentials: string; // base64 encoded
}

export interface IIbisAdaptor {
  query: (
    query: string,
    dataSource: DataSourceName,
    connectionInfo: BIGQUERYConnectionInfo | PostgresConnectionInfo,
    mdl: Manifest,
  ) => Promise<IbisQueryResponse>;
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

export class IbisAdaptor implements IIbisAdaptor {
  private readonly ibisServerEndpoint: string;
  private readonly dataSourceUrlMap: Record<SupportedDataSource, string> = {
    [SupportedDataSource.POSTGRES]: 'postgres',
    [SupportedDataSource.BIG_QUERY]: 'bigquery',
    [SupportedDataSource.SNOWFLAKE]: 'snowflake',
  };

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
        `${this.ibisServerEndpoint}/v2/ibis/${this.dataSourceUrlMap[dataSource]}/query`,
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
}
