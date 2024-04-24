import { DataSourceName } from '../types';
import { BigQueryStrategy } from './bqStrategy';
import { IDataSourceStrategy } from './dataSourceStrategy';
import { DuckDBStrategy } from './duckdbStrategy';
import { PostgresStrategy } from './postgresStrategy';

export class DataSourceStrategyFactory {
  static create(dataSourceType: string, options: any): IDataSourceStrategy {
    switch (dataSourceType) {
      case DataSourceName.BIG_QUERY:
        return new BigQueryStrategy(options);
      case DataSourceName.DUCKDB:
        return new DuckDBStrategy(options);
      case DataSourceName.POSTGRES:
        return new PostgresStrategy(options);
      default:
        throw new Error(`Unsupported data source type: ${dataSourceType}`);
    }
  }
}
