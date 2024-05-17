import axios from 'axios';

import { getLogger } from '@server/utils/logger';
const logger = getLogger('IbisAdaptor');
logger.level = 'debug';

export interface IIbisAdaptor {
  query: (
    query: string,
    dataSource: SupportedDataSource,
    connectionInfo: Record<string, any>,
  ) => Promise<QueryResponse>;
}

export enum SupportedDataSource {
  POSTGRES = 'postgres',
  BIGQUERY = 'bigquery',
  SNOWFLAKE = 'snowflake',
}

export interface QueryResponse {
  columns: string[];
  data: any[];
  dtype: Record<string, string>;
}

export class IbisAdaptor implements IIbisAdaptor {
  private readonly ibisServerBaseEndpoint: string;

  constructor({ ibisServerBaseEndpoint }: { ibisServerBaseEndpoint: string }) {
    this.ibisServerBaseEndpoint = ibisServerBaseEndpoint;
  }

  async query(
    query: string,
    dataSource: SupportedDataSource,
    connectionInfo: Record<string, any>,
  ): Promise<QueryResponse> {
    let res: any;
    const body = {
      sql: query,
      ...connectionInfo,
    };
    logger.debug(body);
    try {
      const res = await axios.post(
        `${this.ibisServerBaseEndpoint}/v2/ibis/${dataSource}/query`,
        body,
      );
      const response = res.data;
      return response;
    } catch (e) {
      logger.debug(`Got error when querying ibis: ${e.message}`);
      if (res.status == 422) {
        logger.error(`Validation Error, ${(JSON.stringify(e), null, 2)}`);
        logger.debug(
          `Input connection info: ${JSON.stringify(connectionInfo, null, 2)}`,
        );
      }
      throw e;
    }
  }
}
