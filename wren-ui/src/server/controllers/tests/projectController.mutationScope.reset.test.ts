import { ProjectController } from '../projectController';

describe('ProjectController', () => {
  const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

  afterEach(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  const createAuthorizationActor = () => ({
    principalType: 'user',
    principalId: 'user-1',
    workspaceId: 'workspace-1',
    workspaceMemberId: 'member-1',
    workspaceRoleKeys: ['owner'],
    permissionScopes: ['workspace:*'],
    isPlatformAdmin: false,
    platformRoleKeys: [],
  });

  const withAuthorizedContext = <T extends Record<string, any>>(ctx: T) =>
    ({
      authorizationActor: createAuthorizationActor(),
      auditEventRepository: {
        createOne: jest.fn(),
      },
      ...ctx,
    }) as any;
  describe('mutation scope requirements', () => {
    it('keeps resetCurrentProject scoped and does not fall back to current project', async () => {
      const resolver = new ProjectController();
      const getCurrentProject = jest.fn();
      const ctx = withAuthorizedContext({
        runtimeScope: null,
        projectService: {
          getCurrentProject,
        },
      });

      await expect(resolver.resetCurrentProject({ ctx })).resolves.toBe(true);

      expect(getCurrentProject).not.toHaveBeenCalled();
    });

    it('passes runtime identity when deleting semantics during reset', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42, type: 'POSTGRES' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          userId: 'user-1',
        },
        telemetry: { sendEvent: jest.fn() },
        schemaChangeRepository: {
          deleteAllBy: jest.fn().mockResolvedValue(undefined),
        },
        deployService: {
          deleteAllByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        askingService: {
          deleteAllByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        modelService: {
          deleteAllViewsByProjectId: jest.fn().mockResolvedValue(undefined),
          deleteAllModelsByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        projectService: {
          deleteProject: jest.fn().mockResolvedValue(undefined),
        },
        wrenAIAdaptor: {
          delete: jest.fn().mockResolvedValue(undefined),
        },
      });

      await expect(resolver.resetCurrentProject({ ctx })).resolves.toBe(true);

      const deleteArg = ctx.wrenAIAdaptor.delete.mock.calls[0][0];
      expect(deleteArg.runtimeIdentity).toMatchObject({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      });
      expect(deleteArg.runtimeIdentity.projectId).toBeUndefined();
    });

    it('passes runtime identity when deploying onboarding changes', async () => {
      const resolver = new ProjectController() as any;
      const ctx = {
        runtimeScope: {
          project: { id: 7, type: 'POSTGRES' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'old-deploy-hash',
          userId: 'user-1',
        },
        mdlService: {
          makeCurrentModelMDL: jest.fn().mockResolvedValue({
            manifest: { models: [] },
          }),
        },
        deployService: {
          deploy: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
        },
      } as any;

      await resolver.deploy(ctx, {
        id: 42,
        sampleDataset: null,
      });

      expect(ctx.deployService.deploy).toHaveBeenCalledWith(
        { models: [] },
        expect.objectContaining({
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: null,
          actorUserId: 'user-1',
        }),
        false,
      );
    });

    it('keeps resetCurrentProject using scoped runtime identity only', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42, type: 'POSTGRES' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          userId: 'user-1',
        },
        telemetry: { sendEvent: jest.fn() },
        schemaChangeRepository: {
          deleteAllBy: jest.fn().mockResolvedValue(undefined),
        },
        deployService: {
          deleteAllByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        askingService: {
          deleteAllByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        modelService: {
          deleteAllViewsByProjectId: jest.fn().mockResolvedValue(undefined),
          deleteAllModelsByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        projectService: {
          deleteProject: jest.fn().mockResolvedValue(undefined),
        },
        wrenAIAdaptor: {
          delete: jest.fn().mockResolvedValue(undefined),
        },
      });

      await resolver.resetCurrentProject({ ctx });

      const deleteArg = ctx.wrenAIAdaptor.delete.mock.calls[0][0];
      expect(deleteArg.runtimeIdentity).toMatchObject({
        deployHash: 'deploy-1',
      });
      expect(deleteArg.runtimeIdentity.projectId).toBeUndefined();
    });

    it('clears the linked knowledge base runtime project when resetting the active draft project', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42, type: 'POSTGRES' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', runtimeProjectId: 42 },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          userId: 'user-1',
        },
        telemetry: { sendEvent: jest.fn() },
        schemaChangeRepository: {
          deleteAllBy: jest.fn().mockResolvedValue(undefined),
        },
        deployService: {
          deleteAllByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        askingService: {
          deleteAllByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        modelService: {
          deleteAllViewsByProjectId: jest.fn().mockResolvedValue(undefined),
          deleteAllModelsByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        knowledgeBaseRepository: {
          updateOne: jest.fn().mockResolvedValue(undefined),
        },
        projectService: {
          deleteProject: jest.fn().mockResolvedValue(undefined),
        },
        wrenAIAdaptor: {
          delete: jest.fn().mockResolvedValue(undefined),
        },
      });

      await expect(resolver.resetCurrentProject({ ctx })).resolves.toBe(true);

      expect(ctx.knowledgeBaseRepository.updateOne).toHaveBeenCalledWith(
        'kb-1',
        {
          runtimeProjectId: null,
        },
      );
    });

    it('does not fail reset when best-effort semantics deletion loses ai-service connectivity', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42, type: 'POSTGRES' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', runtimeProjectId: 42 },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          userId: 'user-1',
        },
        telemetry: { sendEvent: jest.fn() },
        schemaChangeRepository: {
          deleteAllBy: jest.fn().mockResolvedValue(undefined),
        },
        deployService: {
          deleteAllByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        askingService: {
          deleteAllByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        modelService: {
          deleteAllViewsByProjectId: jest.fn().mockResolvedValue(undefined),
          deleteAllModelsByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        knowledgeBaseRepository: {
          updateOne: jest.fn().mockResolvedValue(undefined),
        },
        projectService: {
          deleteProject: jest.fn().mockResolvedValue(undefined),
        },
        wrenAIAdaptor: {
          delete: jest.fn().mockRejectedValue(new Error('connection is lost')),
        },
      });

      await expect(resolver.resetCurrentProject({ ctx })).resolves.toBe(true);

      expect(ctx.projectService.deleteProject).toHaveBeenCalledWith(42);
      expect(ctx.wrenAIAdaptor.delete).toHaveBeenCalled();
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.update',
          resourceType: 'project',
          resourceId: '42',
          result: 'succeeded',
          payloadJson: {
            operation: 'reset_current_project',
            connectionType: 'POSTGRES',
          },
        }),
      );
    });
  });
});
