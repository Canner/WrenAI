import {
  MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE,
  ProjectController,
} from '../projectController';
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
  describe('mutation scope requirements', () => {
    it('returns no recommended relations when workspace scope has no active runtime project yet', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          deployment: null,
        },
        modelRepository: {
          findAllBy: jest.fn(),
        },
      });

      await expect(resolver.autoGenerateRelation({ ctx })).resolves.toEqual([]);
      expect(ctx.modelRepository.findAllBy).not.toHaveBeenCalled();
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          resourceType: 'knowledge_base',
          resourceId: 'kb-1',
          result: 'allowed',
          payloadJson: {
            operation: 'auto_generate_relation',
          },
        }),
      );
    });

    it('rejects direct connection edits for managed federated runtime projects', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: {
            id: 42,
            type: 'TRINO',
            displayName: '[internal] Sales KB federated runtime',
            connectionInfo: {
              host: 'trino',
              port: 8080,
            },
          },
          knowledgeBase: {
            id: 'kb-1',
            name: '销售知识库',
            runtimeProjectId: 42,
          },
        },
        connectorRepository: {
          findAllBy: jest.fn().mockResolvedValue([]),
        },
        projectRepository: {
          updateOne: jest.fn(),
        },
        projectService: {
          getProjectConnectionTables: jest.fn(),
        },
      });

      await expect(
        resolver.updateConnection(
          null,
          {
            data: {
              type: DataSourceName.TRINO,
              properties: {
                displayName: 'custom',
                host: 'new-host',
              },
            },
          },
          ctx,
        ),
      ).rejects.toThrow(MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE);

      expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
      expect(
        ctx.projectService.getProjectConnectionTables,
      ).not.toHaveBeenCalled();
    });

    it('saveConnection backfills connector state before creating the runtime bridge project', async () => {
      const resolver = new ProjectController();
      const upsertKnowledgeBaseConnectorForConnectionSpy = jest
        .spyOn(resolver as any, 'upsertKnowledgeBaseConnectorForConnection')
        .mockResolvedValue({
          id: 'connector-1',
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          type: 'database',
          databaseProvider: 'postgres',
          displayName: 'Warehouse',
          configJson: {
            host: 'db.internal',
            port: 5432,
            database: 'warehouse',
            user: 'postgres',
            ssl: false,
          },
        });
      const createProjectFromConnectionSpy = jest
        .spyOn(resolver as any, 'createProjectFromConnection')
        .mockResolvedValue({
          id: 42,
          type: 'POSTGRES',
          displayName: 'Warehouse',
          connectionInfo: {},
        });
      const ctx = withAuthorizedContext({
        runtimeScope: {
          workspace: { id: 'workspace-1' },
          knowledgeBase: {
            id: 'kb-1',
            workspaceId: 'workspace-1',
            primaryConnectorId: null,
          },
          userId: 'user-1',
        },
        knowledgeBaseRepository: {
          updateOne: jest.fn().mockResolvedValue(undefined),
        },
      });

      await expect(
        resolver.saveConnection(
          null,
          {
            data: {
              type: DataSourceName.POSTGRES,
              properties: {
                displayName: 'Warehouse',
                host: 'db.internal',
                port: 5432,
                database: 'warehouse',
                user: 'postgres',
                password: 'secret',
              },
            },
          },
          ctx,
        ),
      ).resolves.toEqual({
        type: 'POSTGRES',
        properties: {
          displayName: 'Warehouse',
          host: 'db.internal',
          port: 5432,
          database: 'warehouse',
          user: 'postgres',
          ssl: false,
        },
      });

      expect(upsertKnowledgeBaseConnectorForConnectionSpy).toHaveBeenCalled();
      expect(createProjectFromConnectionSpy).toHaveBeenCalled();
      expect(ctx.knowledgeBaseRepository.updateOne).toHaveBeenCalledWith(
        'kb-1',
        {
          primaryConnectorId: 'connector-1',
        },
      );
    });

    it('updates managed federated runtimes through the primary connector without mutating the internal trino project', async () => {
      const resolver = new ProjectController();
      jest
        .spyOn(resolver as any, 'upsertKnowledgeBaseConnectorForConnection')
        .mockResolvedValue({
          id: 'connector-1',
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          type: 'database',
          databaseProvider: 'postgres',
          displayName: 'Warehouse',
          configJson: {
            host: 'db.internal',
            port: 5432,
            database: 'warehouse',
            user: 'postgres',
            ssl: true,
          },
        });
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: {
            id: 42,
            type: 'TRINO',
            displayName: '[internal] Sales KB federated runtime',
            connectionInfo: {
              host: 'trino',
              port: 8080,
            },
          },
          knowledgeBase: {
            id: 'kb-1',
            workspaceId: 'workspace-1',
            runtimeProjectId: 42,
            primaryConnectorId: 'connector-1',
          },
        },
        connectorRepository: {
          findOneBy: jest.fn().mockResolvedValue({
            id: 'connector-1',
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
          }),
        },
        projectRepository: {
          updateOne: jest.fn(),
        },
        projectService: {
          getProjectConnectionTables: jest.fn(),
        },
      });

      await expect(
        resolver.updateConnection(
          null,
          {
            data: {
              type: DataSourceName.POSTGRES,
              properties: {
                displayName: 'Warehouse',
                host: 'db.internal',
                port: 5432,
                database: 'warehouse',
                user: 'postgres',
                ssl: true,
              },
            },
          },
          ctx,
        ),
      ).resolves.toEqual({
        type: 'POSTGRES',
        properties: {
          displayName: 'Warehouse',
          host: 'db.internal',
          port: 5432,
          database: 'warehouse',
          user: 'postgres',
          ssl: true,
        },
      });

      expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
      expect(
        ctx.projectService.getProjectConnectionTables,
      ).not.toHaveBeenCalled();
    });

    it('dual-writes knowledge base language while preserving project-side recommendation generation', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42, sampleDataset: null },
          knowledgeBase: {
            id: 'kb-1',
            sampleDataset: null,
          },
          selector: { runtimeScopeId: 'kb-1' },
        },
        projectRepository: {
          updateOne: jest.fn().mockResolvedValue(undefined),
        },
        knowledgeBaseRepository: {
          updateOne: jest.fn().mockResolvedValue(undefined),
        },
        projectService: {
          generateProjectRecommendationQuestions: jest
            .fn()
            .mockResolvedValue(undefined),
        },
      });

      await expect(
        resolver.updateCurrentProject({ language: 'ZH_CN', ctx }),
      ).resolves.toBe(true);

      expect(ctx.projectRepository.updateOne).toHaveBeenCalledWith(42, {
        language: 'ZH_CN',
      });
      expect(ctx.knowledgeBaseRepository.updateOne).toHaveBeenCalledWith(
        'kb-1',
        {
          language: 'ZH_CN',
        },
      );
      expect(
        ctx.projectService.generateProjectRecommendationQuestions,
      ).toHaveBeenCalledWith(42, 'kb-1');
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.update',
          resourceType: 'knowledge_base',
          resourceId: 'kb-1',
          result: 'succeeded',
          afterJson: {
            language: 'ZH_CN',
          },
          payloadJson: {
            operation: 'update_current_project',
          },
        }),
      );
    });
  });
});
