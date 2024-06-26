import {
  IbisBigQueryConnectionInfo,
  IbisMySQLConnectionInfo,
  IbisPostgresConnectionInfo,
  IbisSqlServerConnectionInfo,
} from './adaptors/ibisAdaptor';
import {
  BIG_QUERY_CONNECTION_INFO,
  DUCKDB_CONNECTION_INFO,
  MYSQL_CONNECTION_INFO,
  POSTGRES_CONNECTION_INFO,
  MS_SQL_CONNECTION_INFO,
  WREN_AI_CONNECTION_INFO,
} from './repositories';
import { DataSourceName } from './types';
import { getConfig } from './config';
import { Encryptor } from './utils';

const config = getConfig();
const encryptor = new Encryptor(config);

export function encryptConnectionInfo(
  dataSourceType: DataSourceName,
  connectionInfo: WREN_AI_CONNECTION_INFO,
) {
  return dataSource[dataSourceType].sensitiveProps.reduce(
    (acc, prop: string) => {
      const value = connectionInfo[prop];
      if (value) {
        const encryption = encryptor.encrypt(
          JSON.parse(JSON.stringify({ [prop]: value })),
        );
        return { ...acc, [prop]: encryption };
      }
      return acc;
    },
    connectionInfo,
  );
}

export function toIbisConnectionInfo(dataSourceType, connectionInfo) {
  return dataSource[dataSourceType].toIbisConnectionInfo(connectionInfo);
}

interface IDataSourceConnectionInfo<C, I> {
  sensitiveProps: string[];
  toIbisConnectionInfo(connectionInfo: C): I;
}

const dataSource = {
  // BigQuery
  [DataSourceName.BIG_QUERY]: {
    sensitiveProps: ['credentials'],
    toIbisConnectionInfo(connectionInfo) {
      const decryptedConnectionInfo = decryptConnectionInfo(
        DataSourceName.BIG_QUERY,
        connectionInfo,
      );
      const { projectId, datasetId, credentials } =
        decryptedConnectionInfo as BIG_QUERY_CONNECTION_INFO;
      const base64Credentials = Buffer.from(
        JSON.stringify(credentials),
      ).toString('base64');
      const res: IbisBigQueryConnectionInfo = {
        project_id: projectId,
        dataset_id: datasetId,
        credentials: base64Credentials,
      };
      return res;
    },
  } as IDataSourceConnectionInfo<
    BIG_QUERY_CONNECTION_INFO,
    IbisBigQueryConnectionInfo
  >,

  // Postgres
  [DataSourceName.POSTGRES]: {
    sensitiveProps: ['password'],
    toIbisConnectionInfo(connectionInfo) {
      const decryptedConnectionInfo = decryptConnectionInfo(
        DataSourceName.POSTGRES,
        connectionInfo,
      );
      const { host, port, database, user, password, ssl } =
        decryptedConnectionInfo as POSTGRES_CONNECTION_INFO;
      let connectionUrl = `postgresql://${user}:${password}@${host}:${port}/${database}?`;
      if (ssl) {
        connectionUrl += 'sslmode=require';
      }
      return {
        connectionUrl,
      };
    },
  } as IDataSourceConnectionInfo<
    POSTGRES_CONNECTION_INFO,
    IbisPostgresConnectionInfo
  >,

  // mysql
  [DataSourceName.MYSQL]: {
    sensitiveProps: ['password'],
    toIbisConnectionInfo(connectionInfo) {
      const decryptedConnectionInfo = decryptConnectionInfo(
        DataSourceName.MYSQL,
        connectionInfo,
      );
      const { host, port, database, user, password } =
        decryptedConnectionInfo as MYSQL_CONNECTION_INFO;
      return { host, port, database, user, password };
    },
  } as IDataSourceConnectionInfo<
    MYSQL_CONNECTION_INFO,
    IbisMySQLConnectionInfo
  >,

  // SQL Server
  [DataSourceName.MSSQL]: {
    sensitiveProps: ['password'],
    toIbisConnectionInfo(connectionInfo) {
      const decryptedConnectionInfo = decryptConnectionInfo(
        DataSourceName.MSSQL,
        connectionInfo,
      );
      const { host, port, database, user, password } =
        decryptedConnectionInfo as MS_SQL_CONNECTION_INFO;
      return { host, port, database, user, password };
    },
  } as IDataSourceConnectionInfo<
    MS_SQL_CONNECTION_INFO,
    IbisSqlServerConnectionInfo
  >,

  // DuckDB
  [DataSourceName.DUCKDB]: {
    sensitiveProps: [],
    toIbisConnectionInfo(_connectionInfo) {
      throw new Error('Not implemented');
    },
  } as IDataSourceConnectionInfo<DUCKDB_CONNECTION_INFO, unknown>,
};

function decryptConnectionInfo(
  dataSourceType: DataSourceName,
  connectionInfo: WREN_AI_CONNECTION_INFO,
): WREN_AI_CONNECTION_INFO {
  return dataSource[dataSourceType].sensitiveProps.reduce(
    (acc, prop: string) => {
      const value = connectionInfo[prop];
      if (value) {
        const decryption = encryptor.decrypt(value);
        const decryptedValue = JSON.parse(decryption)[prop];
        return { ...acc, [prop]: decryptedValue };
      }
      return acc;
    },
    connectionInfo,
  );
}
