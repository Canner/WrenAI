import { DataSourceName } from '@server/types';
import { FederatedRuntimeProjectService } from '../federatedRuntimeProjectService';

describe('FederatedRuntimeProjectService', () => {
  let knowledgeBaseRepository: any;
  let connectorRepository: any;
  let projectRepository: any;
  let deployLogRepository: any;
  let kbSnapshotRepository: any;
  let modelRepository: any;
  let relationRepository: any;
  let viewRepository: any;
  let secretService: any;
  let trinoAdaptor: any;
  let mdlService: any;
  let deployService: any;
  let service: FederatedRuntimeProjectService;

  beforeEach(() => {
    knowledgeBaseRepository = {
      findOneBy: jest.fn(),
      updateOne: jest.fn(),
    };
    connectorRepository = {
      findAllBy: jest.fn(),
      updateOne: jest.fn(),
    };
    projectRepository = {
      findOneBy: jest.fn(),
      createOne: jest
        .fn()
        .mockImplementation(async (payload: any) => ({ id: 501, ...payload })),
      updateOne: jest
        .fn()
        .mockImplementation(async (id: number, payload: any) => ({
          id,
          ...payload,
        })),
      deleteOne: jest.fn(),
    };
    deployLogRepository = {
      deleteAllBy: jest.fn(),
      updateOne: jest.fn(),
    };
    kbSnapshotRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      createOne: jest.fn().mockResolvedValue({
        id: 'snap-1',
        knowledgeBaseId: 'kb-1',
        snapshotKey: 'latest-executable-default',
        displayName: 'Sales KB 默认快照',
        deployHash: 'deploy-1',
        status: 'active',
      }),
      updateOne: jest.fn(),
    };
    modelRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
      updateOne: jest.fn(),
    };
    relationRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
      updateOne: jest.fn(),
    };
    viewRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
      updateOne: jest.fn(),
    };
    secretService = {
      decryptSecretRecord: jest.fn(),
    };
    trinoAdaptor = {
      ensureCatalog: jest.fn(),
      dropCatalog: jest.fn(),
    };
    mdlService = {
      makeCurrentModelMDLByRuntimeIdentity: jest.fn(),
    };
    deployService = {
      deploy: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
      getLastDeploymentByRuntimeIdentity: jest.fn().mockResolvedValue({
        id: 12,
        projectId: 501,
        hash: 'deploy-1',
        kbSnapshotId: null,
      }),
    };

    service = new FederatedRuntimeProjectService({
      knowledgeBaseRepository,
      connectorRepository,
      projectRepository,
      deployLogRepository,
      kbSnapshotRepository,
      modelRepository,
      relationRepository,
      viewRepository,
      secretService,
      trinoAdaptor,
      mdlService,
      deployService,
      runtimeHost: 'trino',
      runtimePort: 8080,
      runtimeUser: 'wrenai',
      runtimePassword: '',
      runtimeSsl: false,
    });
  });

  it('disables federation and removes hidden runtime assets when fewer than two federatable connectors remain', async () => {
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-1',
      workspaceId: 'ws-1',
      name: 'Sales KB',
      runtimeProjectId: 88,
      primaryConnectorId: 'connector-1',
    });
    connectorRepository.findAllBy.mockResolvedValue([
      {
        id: 'connector-1',
        knowledgeBaseId: 'kb-1',
        workspaceId: 'ws-1',
        type: 'database',
        databaseProvider: 'postgres',
        trinoCatalogName: 'kb_kb1_connector1',
        configJson: {
          host: 'db.internal',
          port: 5432,
          database: 'analytics',
          user: 'postgres',
        },
        secretRecordId: 'secret-1',
      },
    ]);
    secretService.decryptSecretRecord.mockResolvedValue({
      password: 'postgres',
    });

    await expect(service.syncKnowledgeBaseFederation('kb-1')).resolves.toEqual({
      knowledgeBaseId: 'kb-1',
      runtimeProjectId: null,
      federatedConnectorIds: [],
      defaultConnectorId: null,
      mode: 'disabled',
    });

    expect(trinoAdaptor.dropCatalog).toHaveBeenCalledWith('kb_kb1_connector1');
    expect(connectorRepository.updateOne).toHaveBeenCalledWith('connector-1', {
      trinoCatalogName: null,
    });
    expect(deployLogRepository.deleteAllBy).toHaveBeenCalledWith({
      projectId: 88,
    });
    expect(projectRepository.deleteOne).toHaveBeenCalledWith(88);
    expect(knowledgeBaseRepository.updateOne).toHaveBeenCalledWith('kb-1', {
      runtimeProjectId: null,
    });
  });

  it('creates a hidden Trino runtime project and redeploys with the default binding first', async () => {
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-1',
      workspaceId: 'ws-1',
      name: 'Sales KB',
      runtimeProjectId: null,
      primaryConnectorId: 'connector-2',
      sampleDataset: 'ecommerce',
      language: 'EN',
    });
    connectorRepository.findAllBy.mockResolvedValue([
      {
        id: 'connector-1',
        knowledgeBaseId: 'kb-1',
        workspaceId: 'ws-1',
        type: 'database',
        databaseProvider: 'postgres',
        trinoCatalogName: null,
        configJson: {
          host: 'postgres.internal',
          port: 5432,
          database: 'analytics',
          user: 'postgres',
          schema: 'public',
        },
        secretRecordId: 'secret-1',
      },
      {
        id: 'connector-2',
        knowledgeBaseId: 'kb-1',
        workspaceId: 'ws-1',
        type: 'database',
        databaseProvider: 'mysql',
        trinoCatalogName: null,
        configJson: {
          host: 'mysql.internal',
          port: 3306,
          database: 'commerce',
          user: 'root',
        },
        secretRecordId: 'secret-2',
      },
    ]);
    secretService.decryptSecretRecord
      .mockResolvedValueOnce({ password: 'postgres' })
      .mockResolvedValueOnce({ password: 'mysql' });
    mdlService.makeCurrentModelMDLByRuntimeIdentity.mockResolvedValue({
      manifest: { models: [] },
    });

    await expect(service.syncKnowledgeBaseFederation('kb-1')).resolves.toEqual({
      knowledgeBaseId: 'kb-1',
      runtimeProjectId: 501,
      federatedConnectorIds: ['connector-2', 'connector-1'],
      defaultConnectorId: 'connector-2',
      mode: 'federated',
    });

    expect(trinoAdaptor.ensureCatalog).toHaveBeenCalledTimes(2);
    expect(connectorRepository.updateOne).toHaveBeenCalledWith(
      'connector-1',
      expect.objectContaining({
        trinoCatalogName: 'kb_kb1_nnector1',
      }),
    );
    expect(connectorRepository.updateOne).toHaveBeenCalledWith(
      'connector-2',
      expect.objectContaining({
        trinoCatalogName: 'kb_kb1_nnector2',
      }),
    );

    expect(projectRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DataSourceName.TRINO,
        displayName: '[internal] Sales KB federated runtime',
        catalog: 'kb_kb1_nnector2',
        schema: 'commerce',
        sampleDataset: 'ecommerce',
        language: 'EN',
        connectionInfo: expect.objectContaining({
          host: 'trino',
          port: 8080,
          schemas: 'kb_kb1_nnector2.commerce,kb_kb1_nnector1.public',
          username: 'wrenai',
          ssl: false,
        }),
      }),
    );
    expect(knowledgeBaseRepository.updateOne).toHaveBeenCalledWith('kb-1', {
      runtimeProjectId: 501,
    });
    expect(deployService.deploy).toHaveBeenCalledWith(
      { models: [] },
      {
        projectId: 501,
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      },
      true,
    );
    expect(kbSnapshotRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        deployHash: 'deploy-1',
      }),
    );
  });
});
