import { ModelController } from '../modelController';
import {
  createContext,
  restoreModelControllerBindingMode,
} from './modelController.testSupport';

describe('ModelController scope guards', () => {
  afterEach(() => {
    restoreModelControllerBindingMode();
  });

  it('resolves response execution context from deploy hash when response project bridge is absent', async () => {
    const resolver = new ModelController() as any;
    const ctx = createContext();
    ctx.deployService.getDeploymentByRuntimeIdentity = jest
      .fn()
      .mockResolvedValue({
        id: 11,
        projectId: 42,
        hash: 'deploy-42',
        manifest: { models: [] },
      });
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 42,
      type: 'POSTGRES',
    });

    const result = await resolver.getResponseExecutionContext(ctx, {
      projectId: null,
      deployHash: 'deploy-42',
    });

    expect(
      ctx.deployService.getDeploymentByRuntimeIdentity,
    ).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-42',
      actorUserId: 'user-1',
    });
    expect(ctx.projectService.getProjectById).toHaveBeenCalledWith(42);
    expect(result.project).toEqual({ id: 42, type: 'POSTGRES' });
    expect(result.manifest).toEqual({ models: [] });
  });

  it('ignores stale response project bridges when canonical runtime execution already has a deploy hash', async () => {
    const resolver = new ModelController() as any;
    const ctx = createContext();
    ctx.deployService.getDeploymentByRuntimeIdentity = jest
      .fn()
      .mockResolvedValue({
        id: 11,
        projectId: 42,
        hash: 'deploy-42',
        manifest: { models: [] },
      });
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 42,
      type: 'POSTGRES',
    });

    await resolver.getResponseExecutionContext(ctx, {
      projectId: 999,
      deployHash: 'deploy-42',
    });

    expect(
      ctx.deployService.getDeploymentByRuntimeIdentity,
    ).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-42',
      actorUserId: 'user-1',
    });
  });

  it('persists createView with null project bridge when canonical runtime identity exists', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.askingService = {
      assertResponseScope: jest.fn().mockResolvedValue(undefined),
      getResponseScoped: jest.fn().mockResolvedValue({
        id: 15,
        sql: 'select 1',
        projectId: null,
        deployHash: 'deploy-response-1',
      }),
    };
    ctx.deployService.getDeploymentByRuntimeIdentity = jest
      .fn()
      .mockResolvedValue({
        id: 11,
        projectId: 42,
        hash: 'deploy-response-1',
        manifest: { models: [] },
      });
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 42,
      type: 'POSTGRES',
    });
    ctx.queryService.describeStatement = jest
      .fn()
      .mockResolvedValue({ columns: [{ name: 'value', type: 'integer' }] });
    ctx.viewRepository.createOne = jest.fn().mockResolvedValue({ id: 20 });

    await resolver.createView({
      name: 'Revenue View',
      responseId: 15,
      rephrasedQuestion: '本月收入',
      ctx,
    });

    expect(ctx.viewRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        resourceType: 'view',
        resourceId: '20',
        result: 'succeeded',
        payloadJson: {
          operation: 'create_view',
        },
      }),
    );
  });

  it('persists createModel with null project bridge when canonical runtime identity exists', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.projectService.getProjectConnectionTables = jest
      .fn()
      .mockResolvedValue([
        {
          name: 'orders',
          properties: { schema: 'public' },
          columns: [{ name: 'order_id', type: 'integer', notNull: true }],
        },
      ]);
    ctx.modelRepository.createOne = jest.fn().mockResolvedValue({ id: 7 });
    ctx.modelColumnRepository.createMany = jest
      .fn()
      .mockResolvedValue([{ id: 1, modelId: 7, sourceColumnName: 'order_id' }]);
    ctx.modelNestedColumnRepository.createMany = jest
      .fn()
      .mockResolvedValue([]);

    await resolver.createModel({
      data: {
        sourceTableName: 'orders',
        fields: ['order_id'],
        primaryKey: 'order_id',
      },
      ctx,
    });

    expect(ctx.modelRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        resourceType: 'model',
        resourceId: '7',
        result: 'succeeded',
        payloadJson: {
          operation: 'create_model',
        },
      }),
    );
  });

  it('loads runtime project from projectService when createModel runtime scope project is absent', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.runtimeScope.project = null;
    ctx.runtimeScope.deployment.projectId = 42;
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 42,
      type: 'POSTGRES',
    });
    ctx.projectService.getProjectConnectionTables = jest
      .fn()
      .mockResolvedValue([
        {
          name: 'orders',
          properties: { schema: 'public' },
          columns: [{ name: 'order_id', type: 'integer', notNull: true }],
        },
      ]);
    ctx.modelRepository.createOne = jest.fn().mockResolvedValue({ id: 7 });
    ctx.modelColumnRepository.createMany = jest
      .fn()
      .mockResolvedValue([{ id: 1, modelId: 7, sourceColumnName: 'order_id' }]);
    ctx.modelNestedColumnRepository.createMany = jest
      .fn()
      .mockResolvedValue([]);

    await resolver.createModel({
      data: {
        sourceTableName: 'orders',
        fields: ['order_id'],
        primaryKey: 'order_id',
      },
      ctx,
    });

    expect(ctx.projectService.getProjectById).toHaveBeenCalledWith(42);
    expect(ctx.projectService.getProjectConnectionTables).toHaveBeenCalledWith({
      id: 42,
      type: 'POSTGRES',
    });
  });

  it('rejects createModel on outdated snapshots', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.runtimeScope.kbSnapshot = { id: 'snapshot-old' };
    ctx.runtimeScope.deployHash = 'deploy-old';
    ctx.modelRepository.createOne = jest.fn();

    await expect(
      resolver.createModel({
        data: {
          sourceTableName: 'orders',
          fields: ['order_id'],
          primaryKey: 'order_id',
        },
        ctx,
      }),
    ).rejects.toThrow('This snapshot is outdated and cannot be executed');

    expect(ctx.modelRepository.createOne).not.toHaveBeenCalled();
  });

  it('rejects getView for views outside the active runtime scope', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.getViewByRuntimeIdentity.mockResolvedValue(null);

    await expect(resolver.getView({ viewId: 4, ctx })).rejects.toThrow(
      'View not found',
    );
  });
});
