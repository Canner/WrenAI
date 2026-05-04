export {
  RedshiftConnectionType as REDSHIFT_AUTH_METHOD,
  DatabricksConnectionType as DATABRICKS_AUTH_METHOD,
} from '@/apollo/client/graphql/__types__';

export enum DATA_SOURCES {
  BIG_QUERY = 'BIG_QUERY',
  DUCKDB = 'DUCKDB',
  POSTGRES = 'POSTGRES',
  MYSQL = 'MYSQL',
  ORACLE = 'ORACLE',
  MSSQL = 'MSSQL',
  CLICK_HOUSE = 'CLICK_HOUSE',
  TRINO = 'TRINO',
  SNOWFLAKE = 'SNOWFLAKE',
  ATHENA = 'ATHENA',
  REDSHIFT = 'REDSHIFT',
  DATABRICKS = 'DATABRICKS',
}

export enum ATHENA_AUTH_METHOD {
  classic = 'classic',
  oidc = 'oidc',
  instance_profile = 'instance_profile',
}
