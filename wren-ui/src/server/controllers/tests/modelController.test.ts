import { ModelController } from '../modelController';
import { ExpressionName } from '../../models';
import { RelationType } from '../../types';

describe('ModelController scope guards', () => {
  const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

  afterEach(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  const createContext = () =>
    ({
      runtimeScope: {
        project: { id: 1 },
        workspace: { id: 'workspace-1' },
        knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
        kbSnapshot: { id: 'snapshot-1' },
        deployment: { hash: 'deploy-1', manifest: { models: [] } },
        deployHash: 'deploy-1',
        userId: 'user-1',
      },
      authorizationActor: {
        principalType: 'user',
        principalId: 'user-1',
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        workspaceRoleKeys: ['owner'],
        permissionScopes: ['workspace:*'],
        isPlatformAdmin: false,
        platformRoleKeys: [],
      },
      auditEventRepository: {
        createOne: jest.fn(),
      },
      telemetry: { sendEvent: jest.fn() },
      modelRepository: {
        findAllByIds: jest.fn(),
        createOne: jest.fn(),
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
      knowledgeBaseRepository: {
        findOneBy: jest.fn(),
      },
      kbSnapshotRepository: {
        findOneBy: jest.fn(),
      },
    }) as any;

  it('rejects createModel without knowledge base write permission', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      workspaceRoleKeys: ['owner'],
      permissionScopes: ['workspace:*'],
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };

    await expect(
      resolver.createModel({
        data: {
          sourceTableName: 'orders',
          fields: ['id'],
          primaryKey: 'id',
        },
        ctx,
      }),
    ).rejects.toThrow('Knowledge base write permission required');

    expect(ctx.modelRepository.createOne).not.toHaveBeenCalled();
  });

  it('records allowed audit when listing models', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.listModelsByRuntimeIdentity.mockResolvedValue([
      {
        id: 7,
        properties: JSON.stringify({ description: 'orders table' }),
      },
    ]);
    ctx.modelColumnRepository.findColumnsByModelIds.mockResolvedValue([]);
    ctx.modelNestedColumnRepository.findNestedColumnsByModelIds = jest
      .fn()
      .mockResolvedValue([]);

    await resolver.listModels({ ctx });

    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'knowledge_base',
        resourceId: 'kb-1',
        result: 'allowed',
        payloadJson: {
          operation: 'list_models',
        },
      }),
    );
  });

  it('rejects listModels without knowledge base read permission in binding-only mode', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      workspaceRoleKeys: ['owner'],
      permissionScopes: ['workspace:*'],
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };

    await expect(resolver.listModels({ ctx })).rejects.toThrow(
      'Knowledge base read permission required',
    );

    expect(ctx.modelService.listModelsByRuntimeIdentity).not.toHaveBeenCalled();
  });

  it('rejects getModel for models outside the active runtime scope', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.getModelByRuntimeIdentity.mockResolvedValue(null);

    await expect(resolver.getModel({ modelId: 7, ctx })).rejects.toThrow(
      'Model not found',
    );

    expect(
      ctx.modelColumnRepository.findColumnsByModelIds,
    ).not.toHaveBeenCalled();
  });

  it('rejects createRelation when referenced models are outside the active scope', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.getModelsByRuntimeIdentity.mockResolvedValue([]);

    await expect(
      resolver.createRelation({
        data: {
          fromModelId: 10,
          toModelId: 11,
          fromColumnId: 100,
          toColumnId: 101,
          type: RelationType.ONE_TO_MANY,
        },
        ctx,
      }),
    ).rejects.toThrow('Model not found');

    expect(
      ctx.modelService.createRelationByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('rejects updateRelation when the relation is outside the active runtime scope', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.getRelationByRuntimeIdentity.mockResolvedValue(null);

    await expect(
      resolver.updateRelation({
        relationId: 5,
        data: { type: RelationType.ONE_TO_MANY },
        ctx,
      }),
    ).rejects.toThrow('Relation not found');

    expect(
      ctx.modelService.updateRelationByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('rejects updateCalculatedField for calculated fields outside the active scope', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.getColumnByRuntimeIdentity.mockResolvedValue(null);

    await expect(
      resolver.updateCalculatedField({
        columnId: 9,
        data: {
          name: 'profit',
          expression: ExpressionName.SUM,
          lineage: [1, 2, 3],
        },
        ctx,
      }),
    ).rejects.toThrow('Calculated field not found');

    expect(
      ctx.modelService.updateCalculatedFieldByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('rejects validateCalculatedField when modelId is outside the active scope', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.getModelsScoped.mockResolvedValue([]);

    await expect(
      resolver.validateCalculatedField({
        name: 'profit',
        modelId: 3,
        columnId: undefined,
        ctx,
      }),
    ).rejects.toThrow('Model not found');

    expect(
      ctx.modelService.validateCalculatedFieldNaming,
    ).not.toHaveBeenCalled();
  });

  it('rejects validateCalculatedField without knowledge base write permission in binding-only mode', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };

    await expect(
      resolver.validateCalculatedField({
        name: 'profit',
        modelId: 1,
        columnId: undefined,
        ctx,
      }),
    ).rejects.toThrow('Knowledge base write permission required');

    expect(
      ctx.modelService.validateCalculatedFieldNaming,
    ).not.toHaveBeenCalled();
  });

  it('uses the active runtime scope for previewSql', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.runtimeScope.deployment.projectId = 1;
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 1,
      language: 'EN',
    });
    ctx.queryService.preview.mockResolvedValue({ data: [], columns: [] });

    await resolver.previewSql({
      data: {
        sql: 'select 1',
        limit: 10,
        dryRun: true,
      },
      ctx,
    });

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
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.runtimeScope.project = null;
    ctx.runtimeScope.deployment.projectId = 9;
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 9,
      language: 'EN',
    });
    ctx.queryService.preview.mockResolvedValue({ data: [], columns: [] });

    await resolver.previewSql({
      data: {
        sql: 'select 1',
        limit: 5,
      },
      ctx,
    });

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
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.queryService.preview.mockResolvedValue({ data: [], columns: [] });
    ctx.runtimeScopeResolver.resolveRuntimeScopeId.mockResolvedValue({
      project: { id: 9 },
      deployment: { hash: 'deploy-explicit', manifest: { models: [] } },
    });

    await resolver.previewSql({
      data: {
        sql: 'select 1',
        limit: 5,
        runtimeScopeId: 'deploy-explicit',
      },
      ctx,
    });

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

  it('allows internal AI-service previewSql calls without session actor', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.authorizationActor = null;
    ctx.runtimeScope.userId = null;
    ctx.queryService.preview.mockResolvedValue({ data: [], columns: [] });
    ctx.runtimeScopeResolver.resolveRuntimeScopeId.mockResolvedValue({
      workspace: { id: 'workspace-1' },
      knowledgeBase: { id: 'kb-1' },
      project: { id: 9 },
      deployment: { hash: 'deploy-explicit', manifest: { models: [] } },
    });
    (ctx as any).req = {
      headers: {
        'x-wren-ai-service-internal': '1',
      },
    };

    await expect(
      resolver.previewSql({
        data: {
          sql: 'select 1',
          limit: 5,
          runtimeScopeId: 'deploy-explicit',
        },
        ctx,
      }),
    ).resolves.not.toThrow();

    expect(ctx.queryService.preview).toHaveBeenCalledWith('select 1', {
      project: { id: 9 },
      limit: 5,
      modelingOnly: false,
      manifest: { models: [] },
      dryRun: undefined,
    });
  });

  it('rejects previewSql on outdated snapshots', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.runtimeScope.kbSnapshot = { id: 'snapshot-old' };
    ctx.runtimeScope.deployHash = 'deploy-old';

    await expect(
      resolver.previewSql({
        data: {
          sql: 'select 1',
          limit: 5,
        },
        ctx,
      }),
    ).rejects.toThrow('This snapshot is outdated and cannot be executed');

    expect(ctx.queryService.preview).not.toHaveBeenCalled();
  });

  it('uses deployment-first execution context when previewing model data without a project bridge', async () => {
    const resolver = new ModelController();
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

    await resolver.previewModelData({ modelId: 7, ctx });

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
    const resolver = new ModelController();
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

    const result = await resolver.checkModelSync({ ctx });

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
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        result: 'allowed',
        payloadJson: {
          operation: 'check_model_sync',
        },
      }),
    );
  });

  it('prefers runtime-identity-aware MDL building for checkModelSync even when a legacy project bridge exists', async () => {
    const resolver = new ModelController();
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

    const result = await resolver.checkModelSync({ ctx });

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

  it('rejects checkModelSync without knowledge base read permission in binding-only mode', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.mdlService = {
      makeCurrentModelMDLByRuntimeIdentity: jest.fn(),
    };
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };

    await expect(resolver.checkModelSync({ ctx })).rejects.toThrow(
      'Knowledge base read permission required',
    );

    expect(
      ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('treats missing executable runtime metadata as unsynchronized instead of failing the request', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.mdlService = {
      makeCurrentModelMDLByRuntimeIdentity: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'MDL runtime identity requires deploy metadata or resolvable project metadata',
          ),
        ),
    };

    await expect(resolver.checkModelSync({ ctx })).resolves.toEqual({
      status: 'UNSYNCRONIZED',
    });
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        result: 'allowed',
        payloadJson: {
          operation: 'check_model_sync',
          fallbackStatus: 'UNSYNCRONIZED',
        },
      }),
    );
  });

  it('records allowed access audit events for getMDL', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.deployService.getMDLByHash = jest.fn().mockResolvedValue('mdl-body');

    const result = await resolver.getMDL({ hash: 'deploy-hash-1', ctx });

    expect(ctx.deployService.getMDLByHash).toHaveBeenCalledWith(
      'deploy-hash-1',
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        result: 'allowed',
        payloadJson: {
          operation: 'get_mdl',
          hash: 'deploy-hash-1',
        },
      }),
    );
    expect(result).toEqual({
      hash: 'deploy-hash-1',
      mdl: 'mdl-body',
    });
  });

  it('rejects getMDL without knowledge base read permission in binding-only mode', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };
    ctx.deployService.getMDLByHash = jest.fn();

    await expect(
      resolver.getMDL({ hash: 'deploy-hash-1', ctx }),
    ).rejects.toThrow('Knowledge base read permission required');

    expect(ctx.deployService.getMDLByHash).not.toHaveBeenCalled();
  });

  it('rejects validateView without knowledge base write permission in binding-only mode', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };

    await expect(
      resolver.validateView({
        name: 'Orders View',
        ctx,
      }),
    ).rejects.toThrow('Knowledge base write permission required');

    expect(
      ctx.modelService.validateViewNameByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('prefers runtime-identity-aware MDL building for deploy even when a legacy project bridge exists', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.mdlService = {
      makeCurrentModelMDL: jest.fn(),
      makeCurrentModelMDLByRuntimeIdentity: jest.fn().mockResolvedValue({
        manifest: { models: [] },
        project: {
          id: 42,
          version: '',
          type: 'POSTGRES',
          sampleDataset: null,
        },
      }),
    };
    ctx.projectService.getProjectConnectionVersion = jest
      .fn()
      .mockResolvedValue('16');
    ctx.projectService.updateProject = jest.fn().mockResolvedValue(undefined);
    ctx.projectService.generateProjectRecommendationQuestions = jest
      .fn()
      .mockResolvedValue(undefined);
    ctx.deployService.deploy = jest.fn().mockResolvedValue({
      status: 'SUCCESS',
    });

    const result = await resolver.deploy({ force: false, ctx });

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
    expect(ctx.deployService.deploy).toHaveBeenCalledWith(
      { models: [] },
      expect.objectContaining({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
      false,
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        resourceType: 'project',
        resourceId: '42',
        result: 'succeeded',
        afterJson: { status: 'SUCCESS' },
        payloadJson: {
          operation: 'deploy',
        },
      }),
    );
    expect(result).toEqual({ status: 'SUCCESS' });
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
