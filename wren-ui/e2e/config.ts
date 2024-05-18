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
    projectId: 'bigquery-project-id',
    datasetId: 'bigquery-dataset-id',
    credentialPath: 'bigquery-credential-path',
  },
  duckDb: {
    sqlCsvPath: 'duckdb-sql-csv-path',
  },
  postgreSql: {
    host: 'postgresql-host',
    port: 'postgresql-port',
    username: 'postgresql-username',
    password: 'postgresql-password',
    database: 'postgresql-database',
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
