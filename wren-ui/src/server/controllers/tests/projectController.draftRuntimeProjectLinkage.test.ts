import { ProjectController } from '../projectController';
import { DataSourceName } from '../../types';

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
  describe('draft runtime project linkage', () => {
    it('links a newly saved connection project to the active knowledge base', async () => {
      const resolver = new ProjectController() as any;
      resolver.resetCurrentProject = jest.fn().mockResolvedValue(undefined);

      const project = {
        id: 42,
        type: 'POSTGRES',
        displayName: 'Warehouse',
      };

      const ctx = withAuthorizedContext({
        runtimeScope: {
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', runtimeProjectId: null },
          userId: 'user-1',
        },
        telemetry: { sendEvent: jest.fn() },
        dashboardService: {
          initDashboard: jest.fn().mockResolvedValue(undefined),
        },
        projectService: {
          createProject: jest.fn().mockResolvedValue(project),
          getProjectConnectionTables: jest
            .fn()
            .mockResolvedValue([{ name: 'orders' }]),
          getProjectConnectionVersion: jest.fn().mockResolvedValue('15.0'),
          updateProject: jest.fn().mockResolvedValue(undefined),
        },
        knowledgeBaseRepository: {
          updateOne: jest.fn().mockResolvedValue(undefined),
        },
        projectRepository: {
          deleteOne: jest.fn().mockResolvedValue(undefined),
        },
      });

      await expect(
        resolver.createProjectFromConnection(
          {
            type: DataSourceName.POSTGRES,
            properties: {
              displayName: 'Warehouse',
              host: 'db',
              port: '5432',
            },
          },
          ctx,
        ),
      ).resolves.toEqual(project);

      expect(ctx.knowledgeBaseRepository.updateOne).toHaveBeenCalledWith(
        'kb-1',
        {
          runtimeProjectId: 42,
        },
      );
    });

    it('persists imported models with canonical draft runtime fields for the active knowledge base', async () => {
      const resolver = new ProjectController() as any;
      const createdModels = [{ id: 100, sourceTableName: 'orders' }];
      const ctx = withAuthorizedContext({
        runtimeScope: {
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          kbSnapshot: null,
          deployHash: null,
          userId: 'user-1',
        },
        modelService: {
          deleteAllModelsByProjectId: jest.fn().mockResolvedValue(undefined),
        },
        projectService: {
          getProjectConnectionTables: jest.fn().mockResolvedValue([
            {
              name: 'orders',
              columns: [
                {
                  name: 'order_id',
                  type: 'integer',
                  notNull: true,
                },
              ],
              primaryKey: 'order_id',
              properties: {
                schema: 'public',
              },
            },
          ]),
        },
        modelRepository: {
          createMany: jest.fn().mockResolvedValue(createdModels),
        },
        modelColumnRepository: {
          createMany: jest.fn().mockResolvedValue([
            {
              id: 200,
              modelId: 100,
              sourceColumnName: 'order_id',
            },
          ]),
        },
        modelNestedColumnRepository: {
          createMany: jest.fn().mockResolvedValue([]),
        },
      });

      await resolver.overwriteModelsAndColumns(['orders'], ctx, {
        id: 42,
      });

      expect(ctx.modelRepository.createMany).toHaveBeenCalledWith([
        expect.objectContaining({
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: null,
          deployHash: null,
          actorUserId: 'user-1',
          sourceTableName: 'orders',
        }),
      ]);
    });
  });
});
