import { ConnectorService } from '../connectorService';
import { DataSourceName } from '@server/types';

describe('ConnectorService', () => {
  let connectorRepository: any;
  let workspaceRepository: any;
  let knowledgeBaseRepository: any;
  let secretService: any;
  let metadataService: any;
  let federatedRuntimeProjectService: any;
  let service: ConnectorService;
  const tx = { id: 'tx' };

  beforeEach(() => {
    connectorRepository = {
      transaction: jest.fn().mockResolvedValue(tx),
      commit: jest.fn(),
      rollback: jest.fn(),
      findOneBy: jest.fn(),
      findAllBy: jest.fn(),
      createOne: jest.fn().mockImplementation(async (payload: any) => payload),
      updateOne: jest
        .fn()
        .mockImplementation(async (_id: string, payload: any) => payload),
      deleteOne: jest.fn().mockResolvedValue(1),
    };
    workspaceRepository = {
      findOneBy: jest.fn(),
    };
    knowledgeBaseRepository = {
      findOneBy: jest.fn(),
      findAllBy: jest.fn(),
    };
    secretService = {
      createSecretRecord: jest.fn(),
      updateSecretRecord: jest.fn(),
      deleteSecretRecord: jest.fn(),
      decryptSecretRecord: jest.fn(),
    };
    metadataService = {
      listTables: jest.fn(),
      getVersion: jest.fn(),
    };
    federatedRuntimeProjectService = {
      syncKnowledgeBaseFederation: jest.fn(),
    };

    service = new ConnectorService({
      connectorRepository,
      workspaceRepository,
      knowledgeBaseRepository,
      secretService,
      metadataService,
      federatedRuntimeProjectService,
    });
  });

  it('creates connector and persists secret reference', async () => {
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-1',
      workspaceId: 'workspace-1',
    });
    secretService.createSecretRecord.mockResolvedValue({ id: 'secret-1' });

    const connector = await service.createConnector({
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      type: 'http_api',
      displayName: 'Orders API',
      config: { baseUrl: 'https://api.example.com' },
      secret: { apiKey: 'top-secret' },
      createdBy: 'user-1',
    });

    expect(secretService.createSecretRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        scopeType: 'connector',
        payload: { apiKey: 'top-secret' },
        createdBy: 'user-1',
        scopeId: expect.any(String),
      }),
      { tx },
    );
    expect(connectorRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        type: 'http_api',
        displayName: 'Orders API',
        configJson: { baseUrl: 'https://api.example.com' },
        secretRecordId: 'secret-1',
        createdBy: 'user-1',
      }),
      { tx },
    );
    expect(connector.secretRecordId).toBe('secret-1');
    expect(connectorRepository.commit).toHaveBeenCalledWith(tx);
    expect(
      federatedRuntimeProjectService.syncKnowledgeBaseFederation,
    ).toHaveBeenCalledWith('kb-1');
  });

  it('updates connector secret and mutable fields', async () => {
    connectorRepository.findOneBy.mockResolvedValue({
      id: 'connector-1',
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      type: 'http_api',
      displayName: 'Orders API',
      configJson: { baseUrl: 'https://old.example.com' },
      secretRecordId: 'secret-1',
      createdBy: 'user-1',
    });
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-2',
      workspaceId: 'workspace-1',
    });
    connectorRepository.updateOne.mockImplementation(
      async (_id: string, payload: any) => ({
        id: 'connector-1',
        workspaceId: 'workspace-1',
        ...payload,
      }),
    );

    const connector = await service.updateConnector('connector-1', {
      knowledgeBaseId: 'kb-2',
      displayName: 'Orders API v2',
      config: { baseUrl: 'https://new.example.com' },
      secret: { apiKey: 'rotated-key' },
    });

    expect(secretService.updateSecretRecord).toHaveBeenCalledWith(
      'secret-1',
      { payload: { apiKey: 'rotated-key' } },
      { tx },
    );
    expect(connectorRepository.updateOne).toHaveBeenCalledWith(
      'connector-1',
      expect.objectContaining({
        knowledgeBaseId: 'kb-2',
        displayName: 'Orders API v2',
        configJson: { baseUrl: 'https://new.example.com' },
      }),
      { tx },
    );
    expect(connector.displayName).toBe('Orders API v2');
    expect(connectorRepository.commit).toHaveBeenCalledWith(tx);
    expect(
      federatedRuntimeProjectService.syncKnowledgeBaseFederation,
    ).toHaveBeenNthCalledWith(1, 'kb-1');
    expect(
      federatedRuntimeProjectService.syncKnowledgeBaseFederation,
    ).toHaveBeenNthCalledWith(2, 'kb-2');
  });

  it('deletes connector and cascades to secret service', async () => {
    connectorRepository.findOneBy.mockResolvedValue({
      id: 'connector-1',
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      secretRecordId: 'secret-1',
    });
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-1',
      workspaceId: 'workspace-1',
    });

    await service.deleteConnector('connector-1');

    expect(connectorRepository.deleteOne).toHaveBeenCalledWith('connector-1', {
      tx,
    });
    expect(secretService.deleteSecretRecord).toHaveBeenCalledWith('secret-1', {
      tx,
    });
    expect(connectorRepository.commit).toHaveBeenCalledWith(tx);
    expect(
      federatedRuntimeProjectService.syncKnowledgeBaseFederation,
    ).toHaveBeenCalledWith('kb-1');
  });

  it('rejects connector creation when workspace is missing', async () => {
    workspaceRepository.findOneBy.mockResolvedValue(null);

    await expect(
      service.createConnector({
        workspaceId: 'workspace-missing',
        type: 'http_api',
        displayName: 'Broken',
      }),
    ).rejects.toThrow('Workspace workspace-missing not found');

    expect(connectorRepository.rollback).toHaveBeenCalledWith(tx);
  });

  it('rejects connector creation inside the default workspace', async () => {
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'workspace-default',
      kind: 'default',
    });

    await expect(
      service.createConnector({
        workspaceId: 'workspace-default',
        knowledgeBaseId: null,
        type: 'database',
        displayName: 'Prod PG',
      }),
    ).rejects.toMatchObject({
      message: '系统样例空间不支持接入或管理连接器',
      statusCode: 403,
    });

    expect(connectorRepository.rollback).toHaveBeenCalledWith(tx);
  });

  it('backfills workspace-scoped connectors from legacy knowledge base primaries', async () => {
    const legacyConnector = {
      id: 'connector-kb-1',
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      type: 'database',
      databaseProvider: 'mysql',
      displayName: 'TiDB 业务数据源',
      configJson: {
        host: 'host.docker.internal',
        port: 4000,
        user: 'root',
        database: 'tidb_business_demo',
      },
      secretRecordId: null,
      createdBy: 'user-1',
    };

    connectorRepository.findAllBy.mockResolvedValue([legacyConnector]);
    connectorRepository.findOneBy.mockResolvedValue(legacyConnector);
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'workspace-1',
      kind: 'regular',
    });
    knowledgeBaseRepository.findAllBy.mockResolvedValue([
      {
        id: 'kb-1',
        workspaceId: 'workspace-1',
        primaryConnectorId: 'connector-kb-1',
      },
    ]);
    connectorRepository.createOne.mockImplementation(async (payload: any) => ({
      ...payload,
    }));

    const connectors = await service.listConnectorsByWorkspace('workspace-1');

    expect(connectors).toHaveLength(1);
    expect(connectors[0]).toEqual(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: null,
        type: 'database',
        databaseProvider: 'mysql',
        displayName: 'TiDB 业务数据源',
      }),
    );
    expect(connectorRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: null,
      }),
      { tx },
    );
  });

  it('rejects connector updates for system sample knowledge bases', async () => {
    connectorRepository.findOneBy.mockResolvedValue({
      id: 'connector-sample',
      workspaceId: 'workspace-default',
      knowledgeBaseId: 'kb-sample',
      type: 'database',
      displayName: 'Sample',
      configJson: null,
      secretRecordId: null,
      createdBy: null,
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'workspace-default',
      kind: 'default',
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-sample',
      workspaceId: 'workspace-default',
      kind: 'system_sample',
    });

    await expect(
      service.updateConnector('connector-sample', {
        displayName: 'Updated sample connector',
      }),
    ).rejects.toMatchObject({
      message: '系统样例知识库不支持接入或管理连接器',
      statusCode: 403,
    });

    expect(connectorRepository.rollback).toHaveBeenCalledWith(tx);
  });

  it('resolves decrypted connector secret', async () => {
    connectorRepository.findOneBy.mockResolvedValue({
      id: 'connector-1',
      workspaceId: 'workspace-1',
      type: 'http_api',
      displayName: 'Orders API',
      secretRecordId: 'secret-1',
    });
    secretService.decryptSecretRecord.mockResolvedValue({
      apiKey: 'resolved-secret',
    });

    await expect(service.getResolvedConnector('connector-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'connector-1',
        secret: { apiKey: 'resolved-secret' },
      }),
    );
  });

  it('tests an ad-hoc database connector connection', async () => {
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    metadataService.listTables.mockResolvedValue([
      { name: 'orders' },
      { name: 'customers' },
    ]);
    metadataService.getVersion.mockResolvedValue('PostgreSQL 16.3');

    await expect(
      service.testConnectorConnection({
        workspaceId: 'workspace-1',
        type: 'database',
        databaseProvider: 'postgres',
        config: {
          host: '127.0.0.1',
          port: '5432',
          database: 'analytics',
          username: 'postgres',
        },
        secret: {
          password: 'postgres',
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        connectorType: 'database',
        connectionType: DataSourceName.POSTGRES,
        tableCount: 2,
        sampleTables: ['orders', 'customers'],
        version: 'PostgreSQL 16.3',
      }),
    );
    expect(metadataService.listTables).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DataSourceName.POSTGRES,
      }),
    );
  });

  it('reuses the persisted connector secret when testing an existing connector', async () => {
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-1',
      workspaceId: 'workspace-1',
    });
    connectorRepository.findOneBy.mockResolvedValue({
      id: 'connector-2',
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      type: 'database',
      databaseProvider: 'postgres',
      displayName: 'Warehouse',
      configJson: {
        host: 'warehouse.internal',
        port: 5432,
        database: 'warehouse',
        username: 'readonly',
      },
      secretRecordId: 'secret-2',
    });
    secretService.decryptSecretRecord.mockResolvedValue({
      password: 'stored-password',
    });
    metadataService.listTables.mockResolvedValue([{ name: 'events' }]);
    metadataService.getVersion.mockResolvedValue('PostgreSQL 15');

    await expect(
      service.testConnectorConnection({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        connectorId: 'connector-2',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        connectorType: 'database',
        tableCount: 1,
        sampleTables: ['events'],
      }),
    );
    expect(secretService.decryptSecretRecord).toHaveBeenCalledWith('secret-2');
  });

  it('rejects unsupported connector types for connection testing', async () => {
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });

    await expect(
      service.testConnectorConnection({
        workspaceId: 'workspace-1',
        type: 'rest_json',
        config: { baseUrl: 'https://api.example.com' },
      }),
    ).rejects.toThrow('暂不支持 rest_json 连接器的连接测试');
  });

  it('rejects connector connection tests inside the default workspace', async () => {
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'workspace-default',
      kind: 'default',
    });

    await expect(
      service.testConnectorConnection({
        workspaceId: 'workspace-default',
        type: 'database',
        config: {
          host: '127.0.0.1',
          port: '5432',
          database: 'analytics',
          username: 'postgres',
        },
        secret: {
          password: 'postgres',
        },
      }),
    ).rejects.toMatchObject({
      message: '系统样例空间不支持接入或管理连接器',
      statusCode: 403,
    });
  });
});
