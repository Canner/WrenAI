import axios from 'axios';

import { getLogger } from '@server/utils/logger';
const logger = getLogger('IbisAdaptor');
logger.level = 'debug';

export interface POSTGRESConnectionInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface BIGQUERYConnectionInfo {
  project_id: string;
  dataset_id: string;
  credentials: string; // base64 encoded
}

export interface IIbisAdaptor {
  query: (
    query: string,
    dataSource: SupportedDataSource,
    connectionInfo: BIGQUERYConnectionInfo | POSTGRESConnectionInfo,
  ) => Promise<IbisQueryResponse>;
}

export enum SupportedDataSource {
  POSTGRES = 'POSTGRES',
  BIGQUERY = 'BIG_QUERY',
  SNOWFLAKE = 'SNOWFLAKE',
}

export interface IbisQueryResponse {
  columns: string[];
  data: any[];
  dtypes: Record<string, string>;
}

export class IbisAdaptor implements IIbisAdaptor {
  private readonly ibisServerBaseEndpoint: string;
  private readonly dataSourceUrlMap: Record<SupportedDataSource, string> = {
    [SupportedDataSource.POSTGRES]: 'postgres',
    [SupportedDataSource.BIGQUERY]: 'bigquery',
    [SupportedDataSource.SNOWFLAKE]: 'snowflake',
  };

  constructor({ ibisServerBaseEndpoint }: { ibisServerBaseEndpoint: string }) {
    this.ibisServerBaseEndpoint = ibisServerBaseEndpoint;
  }

  async query(
    query: string,
    dataSource: SupportedDataSource,
    connectionInfo: Record<string, any>,
  ): Promise<IbisQueryResponse> {
    const body = {
      sql: query,
      ...connectionInfo,
    };
    logger.debug(body);
    try {
      const res = await axios.post(
        `${this.ibisServerBaseEndpoint}/v2/ibis/${this.dataSourceUrlMap[dataSource]}/query`,
        body,
      );
      const response = res.data;
      return response;
    } catch (e) {
      logger.debug(`Got error when querying ibis: ${e}`);
      if (e?.status == 422) {
        logger.error(`Validation Error, ${(JSON.stringify(e), null, 2)}`);
        logger.debug(
          `Input connection info: ${JSON.stringify(connectionInfo, null, 2)}`,
        );
      }
      throw e;
    }
  }
}
