export enum DataSourceName {
  BIG_QUERY = 'BIG_QUERY',
  DUCKDB = 'DUCKDB',
  PG = 'PG',
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
