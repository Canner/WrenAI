export enum DataSourceName {
  BIG_QUERY = 'BIG_QUERY',
  DUCKDB = 'DUCKDB',
  POSTGRES = 'POSTGRES',
  MYSQL = 'MYSQL',
  MSSQL = 'MSSQL',
  CLICK_HOUSE = 'CLICK_HOUSE',
  TRINO = 'TRINO',
  SNOWFLAKE = 'SNOWFLAKE',
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
    PGDataSourceProperties
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
