import axios from 'axios';
import {
  IbisAdaptor,
  IbisBigQueryConnectionInfo,
  IbisPostgresConnectionInfo,
  ValidationRules,
} from '../ibisAdaptor';
import { DataSourceName } from '../../types';
import { Manifest } from '../../mdl/type';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('IbisAdaptor', () => {
  let ibisAdaptor: IbisAdaptor;
  const ibisServerEndpoint = 'http://localhost:8080';

  const mockPostgresConnectionInfo: IbisPostgresConnectionInfo = {
    host: 'localhost',
    port: 5432,
    database: 'my-database',
    user: 'my-user',
    password: 'my-password',
    ssl: false,
  };

  const mockBigQueryConnectionInfo: IbisBigQueryConnectionInfo = {
    project_id: 'my-bq-project-id',
    dataset_id: 'my-bq-dataset-id',
    credentials: 'my-bq-credentials',
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

  it('should get postgres constraints', async () => {
    const mockResponse = { data: [] };
    mockedAxios.post.mockResolvedValue(mockResponse);

    const result = await ibisAdaptor.getConstraints(
      DataSourceName.POSTGRES,
      mockPostgresConnectionInfo,
    );

    expect(result).toEqual([]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${ibisServerEndpoint}/v2/ibis/postgres/metadata/constraints`,
      { connectionInfo: mockPostgresConnectionInfo },
    );
  });

  it('should get bigquery constraints', async () => {
    const mockResponse = { data: [] };
    mockedAxios.post.mockResolvedValue(mockResponse);

    const result = await ibisAdaptor.getConstraints(
      DataSourceName.BIG_QUERY,
      mockBigQueryConnectionInfo,
    );

    expect(result).toEqual([]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${ibisServerEndpoint}/v2/ibis/bigquery/metadata/constraints`,
      { connectionInfo: mockBigQueryConnectionInfo },
    );
  });

  //   it('should handle error when getting constraints', async () => {
  //     const mockError = new Error('Error');
  //     mockedAxios.post.mockRejectedValue(mockError);

  //     await expect(ibisAdaptor.getConstraints('dataSource', {})).rejects.toThrow(
  //       'Error',
  //     );
  //   });

  it('should validate with rule COLUMN_IS_VALID', async () => {
    mockedAxios.post.mockResolvedValue(true);
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
      `${ibisServerEndpoint}/v2/ibis/postgres/validate/column_is_valid`,
      {
        connectionInfo: mockPostgresConnectionInfo,
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

    const result = await ibisAdaptor.validate(
      DataSourceName.POSTGRES,
      ValidationRules.COLUMN_IS_VALID,
      mockPostgresConnectionInfo,
      mockManifest,
      parameters,
    );

    expect(result).toEqual({ valid: false, message: 'Error' });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${ibisServerEndpoint}/v2/ibis/postgres/validate/column_is_valid`,
      {
        connectionInfo: mockPostgresConnectionInfo,
        manifestStr: Buffer.from(JSON.stringify(mockManifest)).toString(
          'base64',
        ),
        parameters,
      },
    );
  });
});
