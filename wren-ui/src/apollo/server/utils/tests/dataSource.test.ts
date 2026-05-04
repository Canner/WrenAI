import { encryptConnectionInfo } from '../../dataSource';
import { DataSourceName } from '../../types';
import {
  BIG_QUERY_CONNECTION_INFO,
  DUCKDB_CONNECTION_INFO,
  MYSQL_CONNECTION_INFO,
  POSTGRES_CONNECTION_INFO,
} from '../../repositories';
import { Encryptor } from '@server/utils/encryptor';

jest.mock('@server/utils/encryptor');

const mockedEncryptor = Encryptor as jest.MockedClass<typeof Encryptor>;

describe('Encryptor', () => {
  beforeEach(() => {
    mockedEncryptor.prototype.decrypt.mockReturnValue('decrypted string');
    mockedEncryptor.prototype.encrypt.mockReturnValue('encrypted string');
  });

  it('should encrypt sensitive connection info for BigQuery connection info', async () => {
    const connectionInfo = {
      credentials: 'some-credentials',
      datasetId: 'my-bq-dataset-id',
      projectId: 'my-bq-project-id',
    } as BIG_QUERY_CONNECTION_INFO;

    const encryptedConnectionInfo = await encryptConnectionInfo(
      DataSourceName.BIG_QUERY,
      connectionInfo,
    );

    expect(encryptedConnectionInfo).toEqual({
      credentials: 'encrypted string',
      datasetId: 'my-bq-dataset-id',
      projectId: 'my-bq-project-id',
    });
  });

  it('should encrypt sensitive connection info for Postgres connection info', async () => {
    const connectionInfo = {
      host: 'localhost',
      port: 5432,
      database: 'my-database',
      user: 'my-user',
      password: 'my-password',
      ssl: false,
    } as POSTGRES_CONNECTION_INFO;

    const encryptedConnectionInfo = await encryptConnectionInfo(
      DataSourceName.POSTGRES,
      connectionInfo,
    );

    expect(encryptedConnectionInfo).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'my-database',
      user: 'my-user',
      password: 'encrypted string',
      ssl: false,
    });
  });

  it('should encrypt sensitive connection info for MySQL connection info', async () => {
    const connectionInfo = {
      host: 'localhost',
      port: 5432,
      database: 'my-database',
      user: 'my-user',
      password: 'my-password',
    } as MYSQL_CONNECTION_INFO;

    const encryptedConnectionInfo = await encryptConnectionInfo(
      DataSourceName.MYSQL,
      connectionInfo,
    );

    expect(encryptedConnectionInfo).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'my-database',
      user: 'my-user',
      password: 'encrypted string',
    });
  });

  it('should encrypt sensitive connection info for DuckDB connection info', async () => {
    const connectionInfo = {
      initSql: 'some-sql',
      extensions: ['extension1', 'extension2'],
      configurations: { key: 'value' },
    } as DUCKDB_CONNECTION_INFO;

    const encryptedConnectionInfo = await encryptConnectionInfo(
      DataSourceName.DUCKDB,
      connectionInfo,
    );

    expect(encryptedConnectionInfo).toEqual({
      initSql: 'some-sql',
      extensions: ['extension1', 'extension2'],
      configurations: { key: 'value' },
    });
  });
});
