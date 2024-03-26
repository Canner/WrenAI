export enum DataSourceName {
  BIG_QUERY = 'BIG_QUERY',
  DUCKDB = 'DUCKDB',
}

interface BaseDataSource {
  type: DataSourceName;
}

export interface UsableDataSource extends BaseDataSource {
  requiredProperties: string[];
}

export interface DataSource {
  type: DataSourceName;
  properties: any;
}

export interface SampleDatasetData {
  name: string;
}

export interface BigQueryDataSourceOptions {
  displayName: string;
  location: string;
  projectId: string;
  credentials: string;
}
