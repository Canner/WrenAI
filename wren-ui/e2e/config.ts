import fs from 'fs';
import path from 'path';
import { merge } from 'lodash';

export const testDbConfig = {
  client: 'pg',
  connection:
    process.env.E2E_PG_URL ||
    process.env.PG_URL ||
    'postgres://postgres:postgres@127.0.0.1:9432/wrenai_e2e',
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

const hasPlaceholder = (value: unknown) => {
  if (typeof value !== 'string') {
    return !value;
  }

  const normalized = value.trim();
  if (!normalized) {
    return true;
  }

  return (
    normalized === 'bigquery-credential-path' ||
    normalized.endsWith('-host') ||
    normalized.endsWith('-username') ||
    normalized.endsWith('-password') ||
    normalized.endsWith('-database') ||
    normalized.endsWith('-account') ||
    normalized.endsWith('-schema') ||
    normalized.endsWith('-catalog') ||
    normalized.endsWith('-dataset') ||
    normalized.endsWith('-projectId') ||
    normalized.endsWith('-credential-path') ||
    normalized.includes('placeholder')
  );
};

const hasRequiredStrings = (values: unknown[]) =>
  values.every((value) => !hasPlaceholder(value));

export const hasBigQueryE2EConfig = () => {
  const config = getTestConfig().bigQuery;
  if (!hasRequiredStrings([config.projectId, config.datasetId])) {
    return false;
  }

  const credentialPath = String(config.credentialPath || '').trim();
  if (hasPlaceholder(credentialPath)) {
    return false;
  }

  return fs.existsSync(path.resolve(process.cwd(), credentialPath));
};

export const hasConnectorE2EConfig = (
  connector:
    | 'clickhouse'
    | 'mysql'
    | 'postgresql'
    | 'sqlserver'
    | 'snowflake'
    | 'trino',
) => {
  const config = getTestConfig();

  switch (connector) {
    case 'clickhouse':
      return hasRequiredStrings([
        config.clickhouse.host,
        config.clickhouse.port,
        config.clickhouse.username,
        config.clickhouse.password,
        config.clickhouse.database,
      ]);
    case 'mysql':
      return hasRequiredStrings([
        config.mysql.host,
        config.mysql.port,
        config.mysql.username,
        config.mysql.password,
        config.mysql.database,
      ]);
    case 'postgresql':
      return hasRequiredStrings([
        config.postgreSql.host,
        config.postgreSql.port,
        config.postgreSql.username,
        config.postgreSql.password,
        config.postgreSql.database,
      ]);
    case 'sqlserver':
      return hasRequiredStrings([
        config.sqlServer.host,
        config.sqlServer.port,
        config.sqlServer.username,
        config.sqlServer.password,
        config.sqlServer.database,
      ]);
    case 'snowflake':
      return hasRequiredStrings([
        config.snowflake.username,
        config.snowflake.password,
        config.snowflake.account,
        config.snowflake.database,
        config.snowflake.schema,
      ]);
    case 'trino':
      return hasRequiredStrings([
        config.trino.host,
        config.trino.port,
        config.trino.catalog,
        config.trino.schema,
        config.trino.username,
        config.trino.password,
      ]);
    default:
      return false;
  }
};
