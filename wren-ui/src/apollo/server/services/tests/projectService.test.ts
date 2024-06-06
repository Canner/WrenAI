import { IDataSourceMetadataService, ProjectService } from '@server/services';
import {
  BIG_QUERY_CONNECTION_INFO,
  DUCKDB_CONNECTION_INFO,
  POSTGRES_CONNECTION_INFO,
} from '@server/repositories';
import { Encryptor } from '@server/utils/encryptor';

jest.mock('@server/utils/encryptor');

describe('ProjectService', () => {
  let projectService;
  let mockProjectRepository;
  let mockMetadataService;
  let mockEncryptor;

  beforeEach(() => {
    mockProjectRepository = {
      getCurrentProject: jest.fn(),
    };
    mockMetadataService = new (jest.fn<IDataSourceMetadataService, any[]>())();
    mockEncryptor = {
      encrypt: jest.fn().mockReturnValue('encrypted string'),
      decrypt: jest.fn().mockReturnValue('decrypted string'),
    };

    projectService = new ProjectService({
      projectRepository: mockProjectRepository,
      metadataService: mockMetadataService,
    });

    (Encryptor as jest.Mock).mockImplementation(() => mockEncryptor);
  });

  it('should encrypt sensitive connection info for BigQuery connection info', async () => {
    const connectionInfo = {
      credentials: 'some-credentials',
      datasetId: 'my-bq-dataset-id',
      projectId: 'my-bq-project-id',
    } as BIG_QUERY_CONNECTION_INFO;

    const encryptedConnectionInfo =
      await projectService.encryptSensitiveConnectionInfo(connectionInfo);

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

    const encryptedConnectionInfo =
      await projectService.encryptSensitiveConnectionInfo(connectionInfo);

    expect(encryptedConnectionInfo).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'my-database',
      user: 'my-user',
      password: 'encrypted string',
      ssl: false,
    });
  });

  it('should encrypt sensitive connection info for DuckDB connection info', async () => {
    const connectionInfo = {
      initSql: 'some-sql',
      extensions: ['extension1', 'extension2'],
      configurations: { key: 'value' },
    } as DUCKDB_CONNECTION_INFO;

    const encryptedConnectionInfo =
      await projectService.encryptSensitiveConnectionInfo(connectionInfo);

    expect(encryptedConnectionInfo).toEqual({
      initSql: 'some-sql',
      extensions: ['extension1', 'extension2'],
      configurations: { key: 'value' },
    });
  });
});
