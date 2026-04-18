import { DATA_SOURCES } from '@/utils/enum';
import BigQueryProperties from '@/components/pages/setup/connections/BigQueryProperties';
import DuckDBProperties from '@/components/pages/setup/connections/DuckDBProperties';
import MySQLProperties from '@/components/pages/setup/connections/MySQLProperties';
import OracleProperties from '@/components/pages/setup/connections/OracleProperties';
import PostgreSQLProperties from '@/components/pages/setup/connections/PostgreSQLProperties';
import SQLServerProperties from '@/components/pages/setup/connections/SQLServerProperties';
import ClickHouseProperties from '@/components/pages/setup/connections/ClickHouseProperties';
import TrinoProperties from '@/components/pages/setup/connections/TrinoProperties';
import SnowflakeProperties from '@/components/pages/setup/connections/SnowflakeProperties';
import AthenaProperties from '@/components/pages/setup/connections/AthenaProperties';
import RedshiftProperties from '@/components/pages/setup/connections/RedshiftProperties';
import DatabricksProperties from '@/components/pages/setup/connections/DatabricksProperties';

export const getConnectionTypeImage = (
  connectionType: DATA_SOURCES | string,
) => {
  switch (connectionType) {
    case DATA_SOURCES.BIG_QUERY:
      return '/images/connection/bigQuery.svg';
    case DATA_SOURCES.POSTGRES:
      return '/images/connection/postgreSql.svg';
    case DATA_SOURCES.MYSQL:
      return '/images/connection/mysql.svg';
    case DATA_SOURCES.ORACLE:
      return '/images/connection/oracle.svg';
    case DATA_SOURCES.MSSQL:
      return '/images/connection/sqlserver.svg';
    case DATA_SOURCES.CLICK_HOUSE:
      return '/images/connection/clickhouse.svg';
    case DATA_SOURCES.DUCKDB:
      return '/images/connection/duckDb.svg';
    case DATA_SOURCES.TRINO:
      return '/images/connection/trino.svg';
    case DATA_SOURCES.SNOWFLAKE:
      return '/images/connection/snowflake.svg';
    case DATA_SOURCES.ATHENA:
      return '/images/connection/athena.svg';
    case DATA_SOURCES.REDSHIFT:
      return '/images/connection/redshift.svg';
    case DATA_SOURCES.DATABRICKS:
      return '/images/connection/databricks.svg';
    default:
      return null;
  }
};

export const getConnectionTypeName = (
  connectionType: DATA_SOURCES | string,
) => {
  switch (connectionType) {
    case DATA_SOURCES.BIG_QUERY:
      return 'BigQuery';
    case DATA_SOURCES.POSTGRES:
      return 'PostgreSQL';
    case DATA_SOURCES.MYSQL:
      return 'MySQL';
    case DATA_SOURCES.ORACLE:
      return 'Oracle';
    case DATA_SOURCES.MSSQL:
      return 'SQL Server';
    case DATA_SOURCES.CLICK_HOUSE:
      return 'ClickHouse';
    case DATA_SOURCES.DUCKDB:
      return 'DuckDB';
    case DATA_SOURCES.TRINO:
      return 'Trino';
    case DATA_SOURCES.SNOWFLAKE:
      return 'Snowflake';
    case DATA_SOURCES.ATHENA:
      return 'Athena (Trino)';
    case DATA_SOURCES.REDSHIFT:
      return 'Redshift';
    case DATA_SOURCES.DATABRICKS:
      return 'Databricks';
    default:
      return '';
  }
};

export const getConnectionTypeProperties = (
  connectionType: DATA_SOURCES | string,
) => {
  switch (connectionType) {
    case DATA_SOURCES.BIG_QUERY:
      return BigQueryProperties;
    case DATA_SOURCES.POSTGRES:
      return PostgreSQLProperties;
    case DATA_SOURCES.MYSQL:
      return MySQLProperties;
    case DATA_SOURCES.ORACLE:
      return OracleProperties;
    case DATA_SOURCES.MSSQL:
      return SQLServerProperties;
    case DATA_SOURCES.CLICK_HOUSE:
      return ClickHouseProperties;
    case DATA_SOURCES.DUCKDB:
      return DuckDBProperties;
    case DATA_SOURCES.TRINO:
      return TrinoProperties;
    case DATA_SOURCES.SNOWFLAKE:
      return SnowflakeProperties;
    case DATA_SOURCES.ATHENA:
      return AthenaProperties;
    case DATA_SOURCES.REDSHIFT:
      return RedshiftProperties;
    case DATA_SOURCES.DATABRICKS:
      return DatabricksProperties;
    default:
      return null;
  }
};

export const getConnectionTypeConfig = (
  connectionType: DATA_SOURCES | string,
) => {
  const sourceValue =
    connectionType in DATA_SOURCES
      ? DATA_SOURCES[connectionType as keyof typeof DATA_SOURCES]
      : connectionType;
  return {
    label: getConnectionTypeName(connectionType),
    logo: getConnectionTypeImage(connectionType),
    value: sourceValue,
  };
};

export const getConnectionTypeFormComponent = (
  connectionType: DATA_SOURCES | string,
) => {
  return {
    component: getConnectionTypeProperties(connectionType) || (() => null),
  };
};
