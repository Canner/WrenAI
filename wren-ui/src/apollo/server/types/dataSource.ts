export enum DataSourceName {
  BIG_QUERY = 'BIG_QUERY',
  DUCKDB = 'DUCKDB',
  POSTGRES = 'POSTGRES',
  COUCHBASE = 'COUCHBASE',
}

export interface DataSource {
  type: DataSourceName;
  properties: DataSourceProperties;
  sampleDataset?: string;
}

export interface SampleDatasetData {
  name: string;
}

export type DataSourceProperties = { displayName: string } & Partial<
  BigQueryDataSourceProperties &
    DuckDBDataSourceProperties &
    PGDataSourceProperties & 
    CouchbaseDataSourceProperties
>;

export interface BigQueryDataSourceProperties {
  displayName: string;
  projectId: string;
  datasetId: string;
  credentials: JSON;
}

export interface DuckDBDataSourceProperties {
  displayName: string;
  initSql: string;
  extensions: string[];
  configurations: Record<string, any>;
}

export interface PGDataSourceProperties {
  displayName: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

export interface CouchbaseDataSourceProperties{
  displayName: string;
  server: string;
  user: string;
  password: string;
  ssl?: boolean;
}