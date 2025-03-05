import {
  IbisBigQueryConnectionInfo,
  IbisPostgresConnectionInfo,
  HostBasedConnectionInfo,
  UrlBasedConnectionInfo,
  IbisSnowflakeConnectionInfo,
  IbisTrinoConnectionInfo,
} from './adaptors/ibisAdaptor';
import {
  BIG_QUERY_CONNECTION_INFO,
  DUCKDB_CONNECTION_INFO,
  MYSQL_CONNECTION_INFO,
  POSTGRES_CONNECTION_INFO,
  MS_SQL_CONNECTION_INFO,
  WREN_AI_CONNECTION_INFO,
  CLICK_HOUSE_CONNECTION_INFO,
  TRINO_CONNECTION_INFO,
  SNOWFLAKE_CONNECTION_INFO,
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

export function toMultipleIbisConnectionInfos(dataSourceType, connectionInfo) {
  if (!dataSource[dataSourceType].toMultipleIbisConnectionInfos) {
    return null;
  }
  return dataSource[dataSourceType].toMultipleIbisConnectionInfos(
    connectionInfo,
  );
}

interface IDataSourceConnectionInfo<C, I> {
  sensitiveProps: string[];
  toIbisConnectionInfo(connectionInfo: C): I;
  toMultipleIbisConnectionInfos?(connectionInfo: C): I[];
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

      // url encode password
      const encodedPassword = encodeURIComponent(password);
      let connectionUrl = `postgresql://${user}:${encodedPassword}@${host}:${port}/${database}?`;
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
    HostBasedConnectionInfo
  >,

  // SQL Server
  [DataSourceName.MSSQL]: {
    sensitiveProps: ['password'],
    toIbisConnectionInfo(connectionInfo) {
      const decryptedConnectionInfo = decryptConnectionInfo(
        DataSourceName.MSSQL,
        connectionInfo,
      );
      const { host, port, database, user, password, trustServerCertificate } =
        decryptedConnectionInfo as MS_SQL_CONNECTION_INFO;

      return {
        host,
        port,
        database,
        user,
        password,
        ...(trustServerCertificate && {
          kwargs: { trustServerCertificate: 'YES' },
        }),
      };
    },
  } as IDataSourceConnectionInfo<
    MS_SQL_CONNECTION_INFO,
    HostBasedConnectionInfo
  >,

  // Click House
  [DataSourceName.CLICK_HOUSE]: {
    sensitiveProps: ['password'],
    toIbisConnectionInfo(connectionInfo) {
      const decryptedConnectionInfo = decryptConnectionInfo(
        DataSourceName.CLICK_HOUSE,
        connectionInfo,
      );
      const { host, port, database, user, password, ssl } =
        decryptedConnectionInfo as CLICK_HOUSE_CONNECTION_INFO;
      const encodedPassword = encodeURIComponent(password);
      let connectionUrl = `clickhouse://${user}:${encodedPassword}@${host}:${port}/${database}?`;
      if (ssl) {
        connectionUrl += 'secure=1';
      }
      return { connectionUrl };
    },
  } as IDataSourceConnectionInfo<
    CLICK_HOUSE_CONNECTION_INFO,
    UrlBasedConnectionInfo
  >,
  [DataSourceName.TRINO]: {
    sensitiveProps: ['password'],
    toIbisConnectionInfo(connectionInfo) {
      const { host, password, port, schemas, username, ssl } =
        decryptConnectionInfo(
          DataSourceName.TRINO,
          connectionInfo,
        ) as TRINO_CONNECTION_INFO;
      // pick first schema from schemas
      const [catalog, schema] = schemas.split(',')?.[0]?.split('.') ?? [];
      if (!catalog || !schema) {
        throw new Error('Invalid schema format, expected catalog.schema');
      }
      return {
        host: ssl ? `https://${host}` : `http://${host}`,
        port,
        catalog,
        schema,
        user: username,
        password,
      };
    },
    toMultipleIbisConnectionInfos(connectionInfo) {
      const { host, port, schemas, username, password, ssl } =
        decryptConnectionInfo(
          DataSourceName.TRINO,
          connectionInfo,
        ) as TRINO_CONNECTION_INFO;

      // Helper function to parse and validate schema
      const parseSchema = (schemaStr: string) => {
        const trimmed = schemaStr.trim();
        const [catalog, schema] = trimmed.split('.');
        if (!catalog || !schema) {
          throw new Error(
            `Invalid schema format: "${trimmed}". Expected format: catalog.schema`,
          );
        }
        return { catalog, schema };
      };

      // schemas format will be `catalog.schema, catalog.schema, ...`
      const schemasArray = schemas.split(',').filter(Boolean);
      if (schemasArray.length === 0) {
        throw new Error(
          'No valid schemas provided. Expected format: catalog.schema[, catalog.schema, ...]',
        );
      }

      return schemasArray.map((schema) => {
        const { catalog, schema: schemaName } = parseSchema(schema);

        return {
          host: ssl ? `https://${host}` : `http://${host}`,
          port,
          catalog,
          schema: schemaName,
          user: username,
          password,
        };
      });
    },
  } as IDataSourceConnectionInfo<
    TRINO_CONNECTION_INFO,
    IbisTrinoConnectionInfo
  >,

  // Snowflake
  [DataSourceName.SNOWFLAKE]: {
    sensitiveProps: ['password'],
    toIbisConnectionInfo(connectionInfo) {
      const decryptedConnectionInfo = decryptConnectionInfo(
        DataSourceName.SNOWFLAKE,
        connectionInfo,
      );
      const { user, password, account, database, schema } =
        decryptedConnectionInfo as SNOWFLAKE_CONNECTION_INFO;
      return { user, password, account, database, schema };
    },
  } as IDataSourceConnectionInfo<
    SNOWFLAKE_CONNECTION_INFO,
    IbisSnowflakeConnectionInfo
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
