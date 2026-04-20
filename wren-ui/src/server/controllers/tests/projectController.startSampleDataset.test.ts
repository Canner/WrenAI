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
  describe('startSampleDataset', () => {
    it('rejects importing sample datasets into regular workspaces', async () => {
      const resolver = new ProjectController() as any;
      const ctx = withAuthorizedContext({
        runtimeScope: {
          workspace: { id: 'workspace-1', kind: 'regular' },
          knowledgeBase: { id: 'kb-1', kind: 'regular' },
        },
      });

      await expect(
        resolver.startSampleDataset(null, { data: { name: 'HR' } }, ctx),
      ).rejects.toMatchObject({
        statusCode: 403,
        message:
          '系统样例已集中到系统样例空间，业务工作区不再支持导入样例数据，请直接配置真实数据库连接。',
      });
    });

    it('reuses the newly created project instead of falling back to current project', async () => {
      const resolver = new ProjectController() as any;
      const project = { id: 42, sampleDataset: null };
      const updatedProject = { id: 42, sampleDataset: 'HR' };
      const models = [
        { id: 10, projectId: 42, sourceTableName: 'employees' },
        { id: 11, projectId: 42, sourceTableName: 'departments' },
      ];
      const columns = [
        { id: 100, modelId: 10, referenceName: 'emp_no' },
        { id: 101, modelId: 11, referenceName: 'dept_no' },
      ];

      resolver.createProjectFromConnection = jest
        .fn()
        .mockResolvedValue(project);
      resolver.overwriteModelsAndColumns = jest
        .fn()
        .mockResolvedValue({ models, columns });
      resolver.buildRelationInput = jest.fn().mockReturnValue([]);
      resolver.deploy = jest.fn().mockResolvedValue(undefined);
      resolver.assertKnowledgeBaseWriteAccess = jest
        .fn()
        .mockResolvedValue(undefined);

      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42 },
          workspace: { id: 'workspace-1', kind: 'default' },
        },
        telemetry: { sendEvent: jest.fn() },
        projectService: {
          getCurrentProject: jest.fn(() => {
            throw new Error('should not call projectService.getCurrentProject');
          }),
          getProjectConnectionTables: jest
            .fn()
            .mockResolvedValue([
              { name: 'employees' },
              { name: 'departments' },
            ]),
        },
        modelService: {
          updatePrimaryKeys: jest.fn().mockResolvedValue(undefined),
          batchUpdateModelProperties: jest.fn().mockResolvedValue(undefined),
          batchUpdateColumnProperties: jest.fn().mockResolvedValue(undefined),
          saveRelations: jest.fn().mockResolvedValue([]),
        },
        modelRepository: {
          findAll: jest.fn(() => {
            throw new Error('should not call modelRepository.findAll');
          }),
        },
        modelColumnRepository: {
          findAll: jest.fn(() => {
            throw new Error('should not call modelColumnRepository.findAll');
          }),
        },
        projectRepository: {
          updateOne: jest.fn().mockResolvedValue(updatedProject),
        },
      });

      await expect(
        resolver.startSampleDataset(null, { data: { name: 'HR' } }, ctx),
      ).resolves.toEqual({
        name: 'HR',
        projectId: 42,
        runtimeScopeId: '42',
      });

      expect(resolver.createProjectFromConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'DUCKDB',
        }),
        ctx,
      );
      expect(resolver.assertKnowledgeBaseWriteAccess).toHaveBeenCalledWith(ctx);
      expect(ctx.projectService.getCurrentProject).not.toHaveBeenCalled();
      expect(
        ctx.projectService.getProjectConnectionTables,
      ).toHaveBeenCalledWith(project);

      expect(resolver.buildRelationInput).toHaveBeenCalledWith(
        expect.any(Array),
        models,
        columns,
      );
      expect(resolver.deploy).toHaveBeenCalledWith(ctx, updatedProject);
      expect(ctx.modelService.saveRelations).toHaveBeenCalledWith([]);
      expect(ctx.modelRepository.findAll).not.toHaveBeenCalled();
      expect(ctx.modelColumnRepository.findAll).not.toHaveBeenCalled();
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.update',
          resourceType: 'project',
          resourceId: '42',
          result: 'succeeded',
          afterJson: {
            sampleDataset: 'HR',
          },
          payloadJson: {
            operation: 'start_sample_dataset',
            datasetName: 'HR',
          },
        }),
      );
    });
  });
});
