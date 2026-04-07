import { ModelResolver } from '../modelResolver';
import { ExpressionName } from '../../models';
import { RelationType } from '../../types';

describe('ModelResolver scope guards', () => {
  const createContext = () =>
    ({
      runtimeScope: {
        project: { id: 1 },
        workspace: { id: 'workspace-1' },
        knowledgeBase: { id: 'kb-1' },
        kbSnapshot: { id: 'snapshot-1' },
        deployment: { hash: 'deploy-1', manifest: { models: [] } },
        deployHash: 'deploy-1',
        userId: 'user-1',
      },
      telemetry: { sendEvent: jest.fn() },
      modelRepository: {
        findAllByIds: jest.fn(),
      },
      modelColumnRepository: {
        findOneBy: jest.fn(),
        findColumnsByModelIds: jest.fn(),
      },
      modelNestedColumnRepository: {
        findAllBy: jest.fn(),
      },
      relationRepository: {
        findOneBy: jest.fn(),
        findRelationsBy: jest.fn(),
      },
      viewRepository: {
        findOneBy: jest.fn(),
      },
      modelService: {
        createRelation: jest.fn(),
        createRelationByRuntimeIdentity: jest.fn(),
        updateRelation: jest.fn(),
        updateRelationByRuntimeIdentity: jest.fn(),
        deleteRelation: jest.fn(),
        deleteRelationByRuntimeIdentity: jest.fn(),
        createCalculatedFieldScoped: jest.fn(),
        createCalculatedFieldByRuntimeIdentity: jest.fn(),
        updateCalculatedFieldScoped: jest.fn(),
        updateCalculatedFieldByRuntimeIdentity: jest.fn(),
        validateCalculatedFieldNaming: jest.fn(),
        listModelsByRuntimeIdentity: jest.fn(),
        getModelsByRuntimeIdentity: jest.fn(),
        getModelByRuntimeIdentity: jest.fn(),
        getModelsScoped: jest.fn(),
        getModelScoped: jest.fn(),
        getColumnScoped: jest.fn(),
        getColumnByRuntimeIdentity: jest.fn(),
        getViewScoped: jest.fn(),
        getViewByRuntimeIdentity: jest.fn(),
        getViewsScoped: jest.fn(),
        getViewsByRuntimeIdentity: jest.fn(),
        getRelationScoped: jest.fn(),
        getRelationByRuntimeIdentity: jest.fn(),
        validateViewNameScoped: jest.fn().mockResolvedValue({ valid: true }),
        validateViewNameByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ valid: true }),
      },
      queryService: {
        preview: jest.fn(),
      },
      projectService: {
        getProjectById: jest.fn(),
      },
      runtimeScopeResolver: {
        resolveRuntimeScopeId: jest.fn(),
      },
      deployService: {
        getDeploymentByRuntimeIdentity: jest.fn(),
        getLastDeployment: jest.fn(),
        createMDLHashByRuntimeIdentity: jest.fn(),
      },
    }) as any;

  it('rejects getModel for models outside the active runtime scope', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.modelService.getModelByRuntimeIdentity.mockResolvedValue(null);

    await expect(
      resolver.getModel(null, { where: { id: 7 } }, ctx),
    ).rejects.toThrow('Model not found');

    expect(
      ctx.modelColumnRepository.findColumnsByModelIds,
    ).not.toHaveBeenCalled();
  });

  it('rejects createRelation when referenced models are outside the active scope', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.modelService.getModelsByRuntimeIdentity.mockResolvedValue([]);

    await expect(
      resolver.createRelation(
        null,
        {
          data: {
            fromModelId: 10,
            toModelId: 11,
            fromColumnId: 100,
            toColumnId: 101,
            type: RelationType.ONE_TO_MANY,
          },
        },
        ctx,
      ),
    ).rejects.toThrow('Model not found');

    expect(
      ctx.modelService.createRelationByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('rejects updateRelation when the relation is outside the active runtime scope', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.modelService.getRelationByRuntimeIdentity.mockResolvedValue(null);

    await expect(
      resolver.updateRelation(
        null,
        { where: { id: 5 }, data: { type: RelationType.ONE_TO_MANY } },
        ctx,
      ),
    ).rejects.toThrow('Relation not found');

    expect(
      ctx.modelService.updateRelationByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('rejects updateCalculatedField for calculated fields outside the active scope', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.modelService.getColumnByRuntimeIdentity.mockResolvedValue(null);

    await expect(
      resolver.updateCalculatedField(
        null,
        {
          where: { id: 9 },
          data: {
            name: 'profit',
            expression: ExpressionName.SUM,
            lineage: [1, 2, 3],
          },
        },
        ctx,
      ),
    ).rejects.toThrow('Calculated field not found');

    expect(
      ctx.modelService.updateCalculatedFieldByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('rejects validateCalculatedField when modelId is outside the active scope', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.modelService.getModelsScoped.mockResolvedValue([]);

    await expect(
      resolver.validateCalculatedField(
        null,
        {
          data: {
            name: 'profit',
            modelId: 3,
            columnId: undefined,
          },
        },
        ctx,
      ),
    ).rejects.toThrow('Model not found');

    expect(
      ctx.modelService.validateCalculatedFieldNaming,
    ).not.toHaveBeenCalled();
  });

  it('uses the active runtime scope for previewSql', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.runtimeScope.deployment.projectId = 1;
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 1,
      language: 'EN',
    });
    ctx.queryService.preview.mockResolvedValue({ data: [], columns: [] });

    await resolver.previewSql(
      null,
      {
        data: {
          sql: 'select 1',
          limit: 10,
          dryRun: true,
        },
      },
      ctx,
    );

    expect(ctx.deployService.getLastDeployment).not.toHaveBeenCalled();
    expect(ctx.queryService.preview).toHaveBeenCalledWith('select 1', {
      project: ctx.runtimeScope.project,
      limit: 10,
      modelingOnly: false,
      manifest: ctx.runtimeScope.deployment.manifest,
      dryRun: true,
    });
  });

  it('falls back to projectService when previewSql runtime scope has no project object', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.runtimeScope.project = null;
    ctx.runtimeScope.deployment.projectId = 9;
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 9,
      language: 'EN',
    });
    ctx.queryService.preview.mockResolvedValue({ data: [], columns: [] });

    await resolver.previewSql(
      null,
      {
        data: {
          sql: 'select 1',
          limit: 5,
        },
      },
      ctx,
    );

    expect(ctx.projectService.getProjectById).toHaveBeenCalledWith(9);
    expect(ctx.queryService.preview).toHaveBeenCalledWith('select 1', {
      project: { id: 9, language: 'EN' },
      limit: 5,
      modelingOnly: false,
      manifest: ctx.runtimeScope.deployment.manifest,
      dryRun: undefined,
    });
  });

  it('uses an explicit runtimeScopeId when previewSql is called for AI-service execution', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.queryService.preview.mockResolvedValue({ data: [], columns: [] });
    ctx.runtimeScopeResolver.resolveRuntimeScopeId.mockResolvedValue({
      project: { id: 9 },
      deployment: { hash: 'deploy-explicit', manifest: { models: [] } },
    });

    await resolver.previewSql(
      null,
      {
        data: {
          sql: 'select 1',
          limit: 5,
          runtimeScopeId: 'deploy-explicit',
        },
      },
      ctx,
    );

    expect(ctx.runtimeScopeResolver.resolveRuntimeScopeId).toHaveBeenCalledWith(
      'deploy-explicit',
    );
    expect(ctx.queryService.preview).toHaveBeenCalledWith('select 1', {
      project: { id: 9 },
      limit: 5,
      modelingOnly: false,
      manifest: { models: [] },
      dryRun: undefined,
    });
  });

  it('uses deployment-first execution context when previewing model data without a project bridge', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.modelService.getModelByRuntimeIdentity.mockResolvedValue({
      id: 7,
      projectId: null,
      deployHash: 'deploy-model-1',
      referenceName: 'orders_model',
    });
    ctx.deployService.getDeploymentByRuntimeIdentity.mockResolvedValue({
      projectId: 42,
      manifest: { models: [] },
    });
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 42,
      type: 'POSTGRES',
    });
    ctx.modelColumnRepository.findColumnsByModelIds.mockResolvedValue([
      { id: 1, modelId: 7, referenceName: 'order_id', isCalculated: false },
    ]);
    ctx.queryService.preview.mockResolvedValue({ data: [] });

    await resolver.previewModelData(null, { where: { id: 7 } }, ctx);

    expect(
      ctx.deployService.getDeploymentByRuntimeIdentity,
    ).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-model-1',
      actorUserId: 'user-1',
    });
    expect(ctx.projectService.getProjectById).toHaveBeenCalledWith(42);
  });

  it('uses runtime-identity-aware MDL building when checking model sync without a project bridge', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.runtimeScope.project = { id: null };
    ctx.mdlService = {
      makeCurrentModelMDLByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ manifest: { models: [] }, project: { id: 42 } }),
    };
    ctx.deployService.getLastDeploymentByRuntimeIdentity = jest
      .fn()
      .mockResolvedValue({ hash: 'hash-42' });
    ctx.deployService.getInProgressDeploymentByRuntimeIdentity = jest
      .fn()
      .mockResolvedValue(null);
    ctx.deployService.createMDLHashByRuntimeIdentity = jest
      .fn()
      .mockReturnValue('hash-42');

    const result = await resolver.checkModelSync(null, {}, ctx);

    expect(
      ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: null, deployHash: 'deploy-1' }),
    );
    expect(
      ctx.deployService.getLastDeploymentByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: null, deployHash: 'deploy-1' }),
    );
    expect(
      ctx.deployService.createMDLHashByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      { models: [] },
      expect.objectContaining({ projectId: null, deployHash: 'deploy-1' }),
      42,
    );
    expect(result).toEqual({ status: 'SYNCRONIZED' });
  });

  it('prefers runtime-identity-aware MDL building for checkModelSync even when a legacy project bridge exists', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.mdlService = {
      makeCurrentModelMDL: jest.fn(),
      makeCurrentModelMDLByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ manifest: { models: [] }, project: { id: 42 } }),
    };
    ctx.deployService.getLastDeploymentByRuntimeIdentity = jest
      .fn()
      .mockResolvedValue({ hash: 'hash-42' });
    ctx.deployService.getInProgressDeploymentByRuntimeIdentity = jest
      .fn()
      .mockResolvedValue(null);
    ctx.deployService.createMDLHashByRuntimeIdentity = jest
      .fn()
      .mockReturnValue('hash-42');

    const result = await resolver.checkModelSync(null, {}, ctx);

    expect(ctx.mdlService.makeCurrentModelMDL).not.toHaveBeenCalled();
    expect(
      ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    );
    expect(
      ctx.deployService.getLastDeploymentByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    );
    expect(result).toEqual({ status: 'SYNCRONIZED' });
  });

  it('resolves response execution context from deploy hash when response project bridge is absent', async () => {
    const resolver = new ModelResolver() as any;
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
    const resolver = new ModelResolver() as any;
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
    const resolver = new ModelResolver();
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

    await resolver.createView(
      null,
      {
        data: {
          name: 'Revenue View',
          responseId: 15,
          rephrasedQuestion: '本月收入',
        },
      },
      ctx,
    );

    expect(ctx.viewRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    );
  });

  it('persists createModel with null project bridge when canonical runtime identity exists', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.projectService.getProjectDataSourceTables = jest
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

    await resolver.createModel(
      null,
      {
        data: {
          sourceTableName: 'orders',
          fields: ['order_id'],
          primaryKey: 'order_id',
        },
      },
      ctx,
    );

    expect(ctx.modelRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    );
  });

  it('loads runtime project from projectService when createModel runtime scope project is absent', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.runtimeScope.project = null;
    ctx.runtimeScope.deployment.projectId = 42;
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 42,
      type: 'POSTGRES',
    });
    ctx.projectService.getProjectDataSourceTables = jest
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

    await resolver.createModel(
      null,
      {
        data: {
          sourceTableName: 'orders',
          fields: ['order_id'],
          primaryKey: 'order_id',
        },
      },
      ctx,
    );

    expect(ctx.projectService.getProjectById).toHaveBeenCalledWith(42);
    expect(ctx.projectService.getProjectDataSourceTables).toHaveBeenCalledWith({
      id: 42,
      type: 'POSTGRES',
    });
  });

  it('rejects getView for views outside the active runtime scope', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.modelService.getViewByRuntimeIdentity.mockResolvedValue(null);

    await expect(
      resolver.getView(null, { where: { id: 4 } }, ctx),
    ).rejects.toThrow('View not found');
  });
});
