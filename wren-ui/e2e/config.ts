import fs from 'fs';
import path from 'path';
import { merge } from 'lodash';

export const testDbConfig = {
  client: 'better-sqlite3',
  connection: 'testdb.sqlite3',
  useNullAsDefault: true,
};

// Replace the default test config with your own e2e.config.json
const defaultTestConfig = {
  bigQuery: {
    projectId: 'wrenai',
    datasetId: 'wrenai.tpch_sf1',
    // The credential file should be under "wren-ui" folder
    credentialPath: 'bigquery-credential-path',
  },
  duckDb: {
    sqlCsvPath: 'https://duckdb.org/data/flights.csv',
  },
  postgreSql: {
    host: 'postgresql-host',
    port: '5432',
    username: 'postgresql-username',
    password: 'postgresql-password',
    database: 'postgresql-database',
    ssl: false,
  },
  mysql: {
    host: 'mysql-host',
    port: '3306',
    username: 'mysql-username',
    password: 'mysql-password',
    database: 'mysql-database',
  },
  sqlServer: {
    host: 'sqlserver-host',
    port: '1433',
    username: 'sqlserver-username',
    password: 'sqlserver-password',
    database: 'sqlserver-database',
  },
  trino: {
    host: 'trino-host',
    port: '8081',
    catalog: 'trino-catalog',
    schema: 'trino-schema',
    username: 'trino-username',
    password: 'trino-password',
  },
  clickhouse: {
    host: 'clickhouse-host',
    port: '8443',
    username: 'clickhouse-username',
    password: 'clickhouse-password',
    database: 'clickhouse-database',
    ssl: false,
  },
  snowflake: {
    username: 'snowflake-username',
    password: 'snowflake-password',
    account: 'snowflake-account',
    database: 'snowflake-database',
    schema: 'snowflake-schema',
  },
};

let userTestConfig = {};
try {
  userTestConfig =
    JSON.parse(
      fs.readFileSync(path.resolve(__dirname, 'e2e.config.json'), 'utf8'),
    ) || {};
} catch (_error: any) {
  console.log('No e2e config file found.');
}

export const getTestConfig = () => {
  return merge(defaultTestConfig, userTestConfig);
};
