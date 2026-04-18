import { SqlPairService } from '../sqlPairService';

describe('SqlPairService', () => {
  const createService = () => {
    const tx = { commit: jest.fn(), rollback: jest.fn() };
    const sqlPairRepository = {
      transaction: jest.fn().mockResolvedValue(tx),
      findAllByRuntimeIdentity: jest.fn(),
      findOneByIdWithRuntimeIdentity: jest.fn(),
      createOne: jest.fn(),
      createMany: jest.fn(),
      updateOne: jest.fn(),
      deleteOne: jest.fn(),
    } as any;
    const wrenAIAdaptor = {
      deploySqlPair: jest.fn().mockResolvedValue({ queryId: 'query-1' }),
      deleteSqlPairs: jest.fn().mockResolvedValue(undefined),
      getSqlPairResult: jest.fn(),
      getQuestionsResult: jest.fn(),
    } as any;
    const ibisAdaptor = {} as any;
    const service = new SqlPairService({
      sqlPairRepository,
      wrenAIAdaptor,
      ibisAdaptor,
    }) as any;
    service.waitUntilSqlPairResult = jest.fn().mockResolvedValue({});

    return { service, sqlPairRepository, wrenAIAdaptor, tx };
  };

  it('lists sql pairs with deployHash-only runtime identity', async () => {
    const { service, sqlPairRepository } = createService();
    sqlPairRepository.findAllByRuntimeIdentity.mockResolvedValue([]);

    await service.listSqlPairs({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });

    expect(sqlPairRepository.findAllByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });
  });

  it('persists runtime identity fields when creating sql pairs without a project bridge', async () => {
    const { service, sqlPairRepository, wrenAIAdaptor, tx } = createService();
    sqlPairRepository.createOne.mockResolvedValue({
      id: 7,
      sql: 'SELECT 1',
      question: 'What is one?',
    });

    const result = await service.createSqlPair(
      {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
      {
        sql: 'SELECT 1',
        question: 'What is one?',
      },
    );

    expect(sqlPairRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      }),
      { tx },
    );
    expect(wrenAIAdaptor.deploySqlPair).toHaveBeenCalledWith({
      runtimeIdentity: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
      sqlPair: {
        id: 7,
        sql: 'SELECT 1',
        question: 'What is one?',
      },
    });
    expect(tx.commit).toHaveBeenCalled();
    expect(result.id).toBe(7);
  });

  it('drops project bridge from persisted sql pair payload when canonical runtime identity exists', async () => {
    const { service, sqlPairRepository, tx } = createService();
    sqlPairRepository.createOne.mockResolvedValue({
      id: 8,
      sql: 'SELECT 2',
      question: 'What is two?',
    });

    await service.createSqlPair(
      {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
      {
        sql: 'SELECT 2',
        question: 'What is two?',
      },
    );

    expect(sqlPairRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
      { tx },
    );
  });

  it('prefers runtime project catalog and schema for model substitute in federated Trino mode', async () => {
    const { service } = createService();
    const ibisAdaptor = (service as any).ibisAdaptor;
    ibisAdaptor.modelSubstitute = jest
      .fn()
      .mockResolvedValue('SELECT * FROM orders');

    await service.modelSubstitute('SELECT * FROM orders', {
      project: {
        id: 99,
        type: 'TRINO',
        catalog: 'kb_default_catalog',
        schema: 'sales',
        connectionInfo: { host: 'encrypted' },
      },
      manifest: {
        models: [
          {
            name: 'orders',
            tableReference: {
              catalog: 'kb_other_catalog',
              schema: 'public',
              table: 'orders',
            },
          },
        ],
      },
    });

    expect(ibisAdaptor.modelSubstitute).toHaveBeenCalledWith(
      'SELECT * FROM orders',
      expect.objectContaining({
        catalog: 'kb_default_catalog',
        schema: 'sales',
      }),
    );
  });

  it('falls back to the first model table reference when project default binding is absent', async () => {
    const { service } = createService();
    const ibisAdaptor = (service as any).ibisAdaptor;
    ibisAdaptor.modelSubstitute = jest
      .fn()
      .mockResolvedValue('SELECT * FROM orders');

    await service.modelSubstitute('SELECT * FROM orders', {
      project: {
        id: 42,
        type: 'POSTGRES',
        catalog: null,
        schema: null,
        connectionInfo: { host: 'encrypted' },
      },
      manifest: {
        models: [
          {
            name: 'orders',
            tableReference: {
              catalog: 'analytics',
              schema: 'public',
              table: 'orders',
            },
          },
        ],
      },
    });

    expect(ibisAdaptor.modelSubstitute).toHaveBeenCalledWith(
      'SELECT * FROM orders',
      expect.objectContaining({
        catalog: 'analytics',
        schema: 'public',
      }),
    );
  });
});
