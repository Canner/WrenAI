import { ModelController } from '../modelController';
import {
  createContext,
  restoreModelControllerBindingMode,
} from './modelController.testSupport';

describe('ModelController scope guards', () => {
  afterEach(() => {
    restoreModelControllerBindingMode();
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
});
