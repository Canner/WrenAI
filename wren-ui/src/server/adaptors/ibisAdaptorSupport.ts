import { DataSourceName } from '@server/types';
import { SupportedDataSource } from './ibisAdaptorTypes';

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
  [SupportedDataSource.DATABRICKS]: 'databricks',
};

export const resolveDataSourceUrl = (dataSource: DataSourceName) => {
  const dataSourceUrl =
    dataSourceUrlMap[dataSource as unknown as SupportedDataSource];
  if (!dataSourceUrl) {
    throw new Error(`Unsupported data source: ${dataSource}`);
  }
  return dataSourceUrl;
};

const getAxiosLikeResponse = (error: unknown) =>
  error && typeof error === 'object' && 'response' in error
    ? (error as { response?: { data?: any; headers?: Record<string, any> } })
        .response || null
    : null;

export const resolveIbisErrorMessage = (error: unknown) => {
  const response = getAxiosLikeResponse(error);
  if (response?.data?.message) {
    return response.data.message;
  }
  if (response?.data) {
    return typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data);
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};
