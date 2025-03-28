import axios from 'axios';
import {
  DryRunResponse,
  IbisAdaptor,
  IbisQueryOptions,
  IbisQueryResponse,
  ValidationRules,
} from '../ibisAdaptor';
import { DataSourceName } from '../../types';
import { Manifest } from '../../mdl/type';
import {
  BIG_QUERY_CONNECTION_INFO,
  CLICK_HOUSE_CONNECTION_INFO,
  MS_SQL_CONNECTION_INFO,
  MYSQL_CONNECTION_INFO,
  POSTGRES_CONNECTION_INFO,
  TRINO_CONNECTION_INFO,
  SNOWFLAKE_CONNECTION_INFO,
} from '../../repositories';
import { snakeCase } from 'lodash';
import { Encryptor } from '../../utils';

jest.mock('axios');
jest.mock('@server/utils/encryptor');
const mockedAxios = axios as jest.Mocked<typeof axios>;
// mock encryptor
const mockedEncryptor = Encryptor as jest.MockedClass<typeof Encryptor>;

describe('IbisAdaptor', () => {
  let ibisAdaptor: IbisAdaptor;
  const ibisServerEndpoint = 'http://localhost:8080';

  const mockMSSQLConnectionInfo: MS_SQL_CONNECTION_INFO = {
    host: 'localhost',
    port: 1433,
    database: 'my-database',
    user: 'my-user',
    password: 'my-password',
    trustServerCertificate: false,
  };

  const mockMySQLConnectionInfo: MYSQL_CONNECTION_INFO = {
    host: 'localhost',
    port: 3306,
    database: 'my-database',
    user: 'my-user',
    password: 'my-password',
  };

  const mockPostgresConnectionInfo: POSTGRES_CONNECTION_INFO = {
    host: 'localhost',
    port: 5432,
    database: 'my-database',
    user: 'my-user',
    password: 'my-password',
    ssl: true,
  };

  const mockClickHouseConnectionInfo: CLICK_HOUSE_CONNECTION_INFO = {
    host: 'my-host',
    port: 8443,
    database: 'my-database',
    user: 'my-user',
    password: 'my-password',
    ssl: true,
  };
  const { host, port, database, user, password } = mockPostgresConnectionInfo;
  const postgresConnectionUrl = `postgresql://${user}:${password}@${host}:${port}/${database}?sslmode=require`;

  const mockBigQueryConnectionInfo: BIG_QUERY_CONNECTION_INFO = {
    projectId: 'my-bq-project-id',
    datasetId: 'my-bq-dataset-id',
    credentials: 'encrypted-credential-string',
  };

  const mockTrinoConnectionInfo: TRINO_CONNECTION_INFO = {
    schemas: 'my-catalog.my-schema',
    host: 'localhost',
    port: 5450,
    password: 'my-password',
    ssl: true,
    username: 'my-username',
  };

  const mockSnowflakeConnectionInfo: SNOWFLAKE_CONNECTION_INFO = {
    user: 'my-user',
    password: 'my-password',
    account: 'my-account',
    database: 'my-database',
    schema: 'my-schema',
  };

  const mockManifest: Manifest = {
    catalog: 'wrenai', // eg: "test-catalog"
    schema: 'wrenai', // eg: "test-schema"
    models: [
      {
        name: 'test_table',
        tableReference: {
          catalog: 'wrenai',
          schema: 'wrenai',
          table: 'test_table',
        },
        properties: {
          description: 'test table',
        },
        columns: [
          {
            name: 'id',
            type: 'integer',
            properties: {},
            isCalculated: false,
          },
          {
            name: 'sumId',
            type: 'float',
            properties: {},
            isCalculated: true,
            expression: 'SUM(id)',
          },
        ],
        cached: false,
      },
    ],
    relationships: [],
    views: [],
  };

  beforeEach(() => {
    ibisAdaptor = new IbisAdaptor({
      ibisServerEndpoint: ibisServerEndpoint,
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should get mssql constraints', async () => {
    const mockResponse = { data: [] };
    mockedAxios.post.mockResolvedValue(mockResponse);
    // mock decrypt method in Encryptor to return the same password
    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ password: mockMSSQLConnectionInfo.password }),
    );

    const result = await ibisAdaptor.getConstraints(
      DataSourceName.MSSQL,
      mockMSSQLConnectionInfo,
    );
    const expectConnectionInfo = Object.entries(mockMSSQLConnectionInfo).reduce(
      (acc, [key, value]) => {
        if (key === 'trustServerCertificate') {
          if (value) {
            acc['kwargs'] = { trustServerCertificate: 'YES' };
            return acc;
          }
        } else {
          acc[snakeCase(key)] = value;
        }
        return acc;
      },
      {},
    );

    expect(result).toEqual([]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${ibisServerEndpoint}/v2/connector/mssql/metadata/constraints`,
      { connectionInfo: expectConnectionInfo },
    );
  });

  it('should get mysql constraints', async () => {
    const mockResponse = { data: [] };
    mockedAxios.post.mockResolvedValue(mockResponse);
    // mock decrypt method in Encryptor to return the same password
    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ password: mockMySQLConnectionInfo.password }),
    );

    const result = await ibisAdaptor.getConstraints(
      DataSourceName.MYSQL,
      mockMySQLConnectionInfo,
    );
    const expectConnectionInfo = Object.entries(mockMySQLConnectionInfo).reduce(
      (acc, [key, value]) => ((acc[snakeCase(key)] = value), acc),
      {},
    );

    expect(result).toEqual([]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${ibisServerEndpoint}/v2/connector/mysql/metadata/constraints`,
      { connectionInfo: expectConnectionInfo },
    );
  });

  // check clickhouse connection info
  it.each([
    [
      {
        host: 'my-host',
        port: 8443,
        database: 'my-database',
        user: 'my-user',
        password: 'my-password',
        ssl: true,
      },
      `clickhouse://my-user:my-password@my-host:8443/my-database?secure=1`,
    ],
    [
      {
        host: 'my-host',
        port: 8443,
        database: 'my-database',
        user: 'my-user',
        password: 'my-password',
        ssl: false,
      },
      `clickhouse://my-user:my-password@my-host:8443/my-database?`,
    ],
  ])(
    'should get correct clickhouse connection info',
    async (connectionInfo, expectConnectionUrl) => {
      const mockResponse = { data: [] };
      mockedAxios.post.mockResolvedValue(mockResponse);
      // mock decrypt method in Encryptor to return the same password
      mockedEncryptor.prototype.decrypt.mockReturnValue(
        JSON.stringify({ password: connectionInfo.password }),
      );

      const result = await ibisAdaptor.getConstraints(
        DataSourceName.CLICK_HOUSE,
        connectionInfo,
      );
      const expectConnectionInfo = {
        connectionUrl: expectConnectionUrl,
      };

      expect(result).toEqual([]);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${ibisServerEndpoint}/v2/connector/clickhouse/metadata/constraints`,
        { connectionInfo: expectConnectionInfo },
      );
    },
  );

  it('should get trino constraints', async () => {
    const mockResponse = { data: [] };
    mockedAxios.post.mockResolvedValue(mockResponse);

    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ password: mockTrinoConnectionInfo.password }),
    );

    const result = await ibisAdaptor.getConstraints(
      DataSourceName.TRINO,
      mockTrinoConnectionInfo,
    );

    const { username, host, password, port, schemas, ssl } =
      mockTrinoConnectionInfo;
    const schemasArray = schemas.split(',');
    const [catalog, schema] = schemasArray[0].split('.');
    const expectConnectionInfo = {
      connectionUrl: `trino://${username}:${password}@${host}:${port}/${catalog}/${schema}`,
    };

    if (ssl) expectConnectionInfo.connectionUrl += '&SSL=true';

    expect(result).toEqual([]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${ibisServerEndpoint}/v2/connector/trino/metadata/constraints`,
      { connectionInfo: expectConnectionInfo },
    );
  });

  it('should get snowflake constraints', async () => {
    const mockResponse = { data: [] };
    mockedAxios.post.mockResolvedValue(mockResponse);
    // mock decrypt method in Encryptor to return the same password
    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ password: mockSnowflakeConnectionInfo.password }),
    );

    const result = await ibisAdaptor.getConstraints(
      DataSourceName.SNOWFLAKE,
      mockSnowflakeConnectionInfo,
    );
    const expectConnectionInfo = Object.entries(
      mockSnowflakeConnectionInfo,
    ).reduce((acc, [key, value]) => ((acc[snakeCase(key)] = value), acc), {});

    expect(result).toEqual([]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${ibisServerEndpoint}/v2/connector/snowflake/metadata/constraints`,
      { connectionInfo: expectConnectionInfo },
    );
  });

  it('should get click house constraints', async () => {
    const mockResponse = { data: [] };
    mockedAxios.post.mockResolvedValue(mockResponse);
    // mock decrypt method in Encryptor to return the same password
    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ password: mockClickHouseConnectionInfo.password }),
    );

    const result = await ibisAdaptor.getConstraints(
      DataSourceName.CLICK_HOUSE,
      mockClickHouseConnectionInfo,
    );
    const { user, password, host, port, database, ssl } =
      mockClickHouseConnectionInfo;
    const expectConnectionInfo = {
      connectionUrl: `clickhouse://${user}:${password}@${host}:${port}/${database}${ssl ? '?secure=1' : ''}`,
    };

    expect(result).toEqual([]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${ibisServerEndpoint}/v2/connector/clickhouse/metadata/constraints`,
      { connectionInfo: expectConnectionInfo },
    );
  });

  it('should get postgres constraints', async () => {
    const mockResponse = { data: [] };
    mockedAxios.post.mockResolvedValue(mockResponse);
    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ password: mockPostgresConnectionInfo.password }),
    );

    const result = await ibisAdaptor.getConstraints(
      DataSourceName.POSTGRES,
      mockPostgresConnectionInfo,
    );

    expect(result).toEqual([]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${ibisServerEndpoint}/v2/connector/postgres/metadata/constraints`,
      {
        connectionInfo: {
          connectionUrl: postgresConnectionUrl,
        },
      },
    );
  });

  it('should get bigquery constraints', async () => {
    const mockResponse = { data: [] };
    mockedAxios.post.mockResolvedValue(mockResponse);
    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ credentials: mockBigQueryConnectionInfo.credentials }),
    );
    const result = await ibisAdaptor.getConstraints(
      DataSourceName.BIG_QUERY,
      mockBigQueryConnectionInfo,
    );
    const expectConnectionInfo = Object.entries(
      mockBigQueryConnectionInfo,
    ).reduce((acc, [key, value]) => {
      if (key === 'credentials') {
        acc['credentials'] = Buffer.from(
          JSON.stringify(mockBigQueryConnectionInfo.credentials),
        ).toString('base64');
      } else {
        acc[snakeCase(key)] = value;
      }
      return acc;
    }, {});

    expect(result).toEqual([]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${ibisServerEndpoint}/v2/connector/bigquery/metadata/constraints`,
      { connectionInfo: expectConnectionInfo },
    );
  });

  it('should validate with rule COLUMN_IS_VALID', async () => {
    mockedAxios.post.mockResolvedValue(true);
    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ password: mockPostgresConnectionInfo.password }),
    );

    const parameters = {
      modelName: 'test_table',
      columnName: 'sumId',
    };
    const result = await ibisAdaptor.validate(
      DataSourceName.POSTGRES,
      ValidationRules.COLUMN_IS_VALID,
      mockPostgresConnectionInfo,
      mockManifest,
      parameters,
    );

    expect(result).toEqual({ valid: true, message: null });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${ibisServerEndpoint}/v2/connector/postgres/validate/column_is_valid`,
      {
        connectionInfo: { connectionUrl: postgresConnectionUrl },
        manifestStr: Buffer.from(JSON.stringify(mockManifest)).toString(
          'base64',
        ),
        parameters,
      },
    );
  });

  it('should handle error when validating', async () => {
    const mockError = { response: { data: 'Error' } };
    const parameters = {
      modelName: 'test_table',
      columnName: 'sumId',
    };
    mockedAxios.post.mockRejectedValue(mockError);
    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ password: mockPostgresConnectionInfo.password }),
    );

    const result = await ibisAdaptor.validate(
      DataSourceName.POSTGRES,
      ValidationRules.COLUMN_IS_VALID,
      mockPostgresConnectionInfo,
      mockManifest,
      parameters,
    );

    expect(result).toEqual({ valid: false, message: 'Error' });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${ibisServerEndpoint}/v2/connector/postgres/validate/column_is_valid`,
      {
        connectionInfo: { connectionUrl: postgresConnectionUrl },
        manifestStr: Buffer.from(JSON.stringify(mockManifest)).toString(
          'base64',
        ),
        parameters,
      },
    );
  });

  it('should get data, correlationId and processTime', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        columns: [],
        data: [],
        dtypes: {},
      },
      headers: {
        'x-correlation-id': '123',
        'x-process-time': '1s',
      },
    });
    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ password: mockPostgresConnectionInfo.password }),
    );

    const res: IbisQueryResponse = await ibisAdaptor.query(
      'SELECT * FROM test_table',
      {
        dataSource: DataSourceName.POSTGRES,
        connectionInfo: mockPostgresConnectionInfo,
        mdl: mockManifest,
        limit: 10,
      } as IbisQueryOptions,
    );

    expect(res.data).toEqual([]);
    expect(res.correlationId).toEqual('123');
    expect(res.processTime).toEqual('1s');
  });

  it('should throw an exception with correlationId and processTime when query fails', async () => {
    mockedAxios.post.mockRejectedValue({
      response: {
        data: 'Error message',
        headers: {
          'x-correlation-id': '123',
          'x-process-time': '1s',
        },
      },
    });
    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ password: mockPostgresConnectionInfo.password }),
    );

    await expect(
      ibisAdaptor.query('SELECT * FROM test_table', {
        dataSource: DataSourceName.POSTGRES,
        connectionInfo: mockPostgresConnectionInfo,
        mdl: mockManifest,
        limit: 10,
      }),
    ).rejects.toMatchObject({
      message: 'Error message',
      extensions: {
        other: {
          correlationId: '123',
          processTime: '1s',
        },
      },
    });
  });

  it('should get data, correlationId and processTime when dry run succeeds', async () => {
    mockedAxios.post.mockResolvedValue({
      headers: {
        'x-correlation-id': '123',
        'x-process-time': '1s',
      },
    });
    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ password: mockPostgresConnectionInfo.password }),
    );

    const res: DryRunResponse = await ibisAdaptor.dryRun(
      'SELECT * FROM test_table',
      {
        dataSource: DataSourceName.POSTGRES,
        connectionInfo: mockPostgresConnectionInfo,
        mdl: mockManifest,
      } as IbisQueryOptions,
    );

    expect(res.correlationId).toEqual('123');
    expect(res.processTime).toEqual('1s');
  });

  it('should throw an exception with correlationId and processTime when dry run fails', async () => {
    mockedAxios.post.mockRejectedValue({
      response: {
        data: 'Error message',
        headers: {
          'x-correlation-id': '123',
          'x-process-time': '1s',
        },
      },
    });
    mockedEncryptor.prototype.decrypt.mockReturnValue(
      JSON.stringify({ password: mockPostgresConnectionInfo.password }),
    );

    await expect(
      ibisAdaptor.dryRun('SELECT * FROM test_table', {
        dataSource: DataSourceName.POSTGRES,
        connectionInfo: mockPostgresConnectionInfo,
        mdl: mockManifest,
      }),
    ).rejects.toMatchObject({
      message: 'Error message',
      extensions: {
        other: {
          correlationId: '123',
          processTime: '1s',
        },
      },
    });
  });
});
