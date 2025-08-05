import { DATA_SOURCES } from '@/utils/enum';
import BigQueryProperties from '@/components/pages/setup/dataSources/BigQueryProperties';
import DuckDBProperties from '@/components/pages/setup/dataSources/DuckDBProperties';
import MySQLProperties from '@/components/pages/setup/dataSources/MySQLProperties';
import OracleProperties from '@/components/pages/setup/dataSources/OracleProperties';
import PostgreSQLProperties from '@/components/pages/setup/dataSources/PostgreSQLProperties';
import SQLServerProperties from '@/components/pages/setup/dataSources/SQLServerProperties';
import ClickHouseProperties from '@/components/pages/setup/dataSources/ClickHouseProperties';
import TrinoProperties from '@/components/pages/setup/dataSources/TrinoProperties';
import SnowflakeProperties from '@/components/pages/setup/dataSources/SnowflakeProperties';
import AthenaProperties from '@/components/pages/setup/dataSources/AthenaProperties';
import RedshiftProperties from '@/components/pages/setup/dataSources/RedshiftProperties';

export const getDataSourceImage = (dataSource: DATA_SOURCES | string) => {
  switch (dataSource) {
    case DATA_SOURCES.BIG_QUERY:
      return '/images/dataSource/bigQuery.svg';
    case DATA_SOURCES.POSTGRES:
      return '/images/dataSource/postgreSql.svg';
    case DATA_SOURCES.MYSQL:
      return '/images/dataSource/mysql.svg';
    case DATA_SOURCES.ORACLE:
      return '/images/dataSource/oracle.svg';
    case DATA_SOURCES.MSSQL:
      return '/images/dataSource/sqlserver.svg';
    case DATA_SOURCES.CLICK_HOUSE:
      return '/images/dataSource/clickhouse.svg';
    case DATA_SOURCES.DUCKDB:
      return '/images/dataSource/duckDb.svg';
    case DATA_SOURCES.TRINO:
      return '/images/dataSource/trino.svg';
    case DATA_SOURCES.SNOWFLAKE:
      return '/images/dataSource/snowflake.svg';
    case DATA_SOURCES.ATHENA:
      return '/images/dataSource/athena.svg';
    case DATA_SOURCES.REDSHIFT:
      return '/images/dataSource/redshift.svg';
    default:
      return null;
  }
};

export const getDataSourceName = (dataSource: DATA_SOURCES | string) => {
  switch (dataSource) {
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
    default:
      return '';
  }
};

export const getDataSourceProperties = (dataSource: DATA_SOURCES | string) => {
  switch (dataSource) {
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
    default:
      return null;
  }
};

export const getDataSourceConfig = (dataSource: DATA_SOURCES | string) => {
  return {
    label: getDataSourceName(dataSource),
    logo: getDataSourceImage(dataSource),
    value: DATA_SOURCES[dataSource],
  };
};

export const getDataSourceFormComponent = (
  dataSource: DATA_SOURCES | string,
) => {
  return { component: getDataSourceProperties(dataSource) || (() => null) };
};
