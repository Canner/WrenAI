import {
  MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE,
  ProjectController,
} from '../projectController';

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
    it('resolves settings from deployment project when runtime scope project is absent', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          deployment: { projectId: 42 },
        },
        config: {},
        connectorRepository: {
          findAllBy: jest.fn().mockResolvedValue([]),
        },
        projectService: {
          getProjectById: jest.fn().mockResolvedValue({
            id: 42,
            type: 'POSTGRES',
            displayName: 'Warehouse',
            sampleDataset: null,
            language: 'EN',
          }),
          getGeneralConnectionInfo: jest.fn().mockReturnValue({ host: 'db' }),
        },
      });

      await expect(resolver.getSettings({ ctx })).resolves.toEqual({
        productVersion: '',
        connection: {
          type: 'POSTGRES',
          properties: {
            displayName: 'Warehouse',
            host: 'db',
          },
          sampleDataset: null,
        },
        language: 'EN',
      });
      expect(ctx.projectService.getProjectById).toHaveBeenCalledWith(42);
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          result: 'allowed',
          payloadJson: {
            operation: 'get_settings',
          },
        }),
      );
    });

    it('prefers runtime knowledge base language and sample dataset in settings', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          deployment: { projectId: 42 },
          knowledgeBase: {
            id: 'kb-1',
            language: 'ZH_CN',
            sampleDataset: 'ECOMMERCE',
          },
        },
        config: {},
        connectorRepository: {
          findAllBy: jest.fn().mockResolvedValue([]),
        },
        projectService: {
          getProjectById: jest.fn().mockResolvedValue({
            id: 42,
            type: 'POSTGRES',
            displayName: 'Warehouse',
            sampleDataset: null,
            language: 'EN',
          }),
          getGeneralConnectionInfo: jest.fn().mockReturnValue({ host: 'db' }),
        },
      });

      await expect(resolver.getSettings({ ctx })).resolves.toEqual({
        productVersion: '',
        connection: {
          type: 'POSTGRES',
          properties: {
            displayName: 'Warehouse',
            host: 'db',
          },
          sampleDataset: 'ECOMMERCE',
        },
        language: 'ZH_CN',
      });
    });

    it('masks internal federated runtime display name and marks settings as managed', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          deployment: { projectId: 42 },
          knowledgeBase: {
            id: 'kb-1',
            name: '销售知识库',
            runtimeProjectId: 42,
            sampleDataset: null,
            language: 'ZH_CN',
          },
        },
        config: {},
        connectorRepository: {
          findAllBy: jest.fn().mockResolvedValue([]),
        },
        projectService: {
          getProjectById: jest.fn().mockResolvedValue({
            id: 42,
            type: 'TRINO',
            displayName: '[internal] Sales KB federated runtime',
            sampleDataset: null,
            language: 'EN',
          }),
          getGeneralConnectionInfo: jest.fn().mockReturnValue({
            host: 'trino',
            port: 8080,
            schemas: 'catalog_a.public',
          }),
        },
      });

      await expect(resolver.getSettings({ ctx })).resolves.toEqual({
        productVersion: '',
        connection: {
          type: 'TRINO',
          properties: {
            displayName: '销售知识库',
            host: 'trino',
            port: 8080,
            schemas: 'catalog_a.public',
            managedFederatedRuntime: true,
            readonlyReason: MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE,
          },
          sampleDataset: null,
        },
        language: 'ZH_CN',
      });
    });

    it('prefers primary connector settings over internal runtime project settings', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          deployment: { projectId: 42 },
          knowledgeBase: {
            id: 'kb-1',
            workspaceId: 'workspace-1',
            primaryConnectorId: 'connector-1',
            runtimeProjectId: 42,
            sampleDataset: null,
            language: 'ZH_CN',
          },
        },
        config: {},
        connectorRepository: {
          findOneBy: jest.fn().mockResolvedValue({
            id: 'connector-1',
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            type: 'database',
            databaseProvider: 'postgres',
            displayName: 'Primary Warehouse',
            configJson: {
              host: 'pg.internal',
              port: 5432,
              database: 'warehouse',
              user: 'postgres',
              ssl: false,
            },
          }),
        },
        projectService: {
          getProjectById: jest.fn().mockResolvedValue({
            id: 42,
            type: 'TRINO',
            displayName: '[internal] Sales KB federated runtime',
            sampleDataset: null,
            language: 'EN',
          }),
          getGeneralConnectionInfo: jest.fn().mockReturnValue({
            host: 'trino',
          }),
        },
      });

      await expect(resolver.getSettings({ ctx })).resolves.toEqual({
        productVersion: '',
        connection: {
          type: 'POSTGRES',
          properties: {
            displayName: 'Primary Warehouse',
            host: 'pg.internal',
            port: 5432,
            database: 'warehouse',
            user: 'postgres',
            ssl: false,
          },
          sampleDataset: null,
        },
        language: 'ZH_CN',
      });
    });

    it('rejects settings reads in binding-only mode without granted actions', async () => {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42, type: 'POSTGRES', displayName: 'Warehouse' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
        },
        config: {},
        authorizationActor: {
          ...createAuthorizationActor(),
          workspaceRoleKeys: ['owner'],
          permissionScopes: ['workspace:*'],
          grantedActions: [],
          workspaceRoleSource: 'legacy',
          platformRoleSource: 'legacy',
        },
        projectService: {
          getGeneralConnectionInfo: jest.fn(),
        },
      });

      await expect(resolver.getSettings({ ctx })).rejects.toThrow(
        'Knowledge base read permission required',
      );

      expect(
        ctx.projectService.getGeneralConnectionInfo,
      ).not.toHaveBeenCalled();
    });

    it('rejects updateCurrentProject when runtime scope is missing', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: null,
        projectRepository: {
          updateOne: jest.fn(),
        },
        projectService: {
          generateProjectRecommendationQuestions: jest.fn(),
        },
      });

      await expect(
        resolver.updateCurrentProject({ language: 'EN', ctx }),
      ).rejects.toThrow(
        'Active runtime project is required for this operation',
      );

      expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
      expect(
        ctx.projectService.generateProjectRecommendationQuestions,
      ).not.toHaveBeenCalled();
    });

    it('records allowed audit when listing connection tables', async () => {
      const resolver = new ProjectController();
      const getProjectConnectionTables = jest
        .fn()
        .mockResolvedValue([{ name: 'orders' }]);
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42, type: 'POSTGRES' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
        },
        projectService: {
          getProjectConnectionTables,
        },
      });

      await expect(resolver.listConnectionTables({ ctx })).resolves.toEqual([
        { name: 'orders' },
      ]);

      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          resourceType: 'project',
          resourceId: '42',
          result: 'allowed',
          payloadJson: {
            operation: 'list_data_source_tables',
          },
        }),
      );
    });

    it('returns an empty table list when workspace scope has no active runtime project yet', async () => {
      const resolver = new ProjectController();
      const getProjectConnectionTables = jest.fn();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          deployment: null,
        },
        projectService: {
          getProjectConnectionTables,
        },
      });

      await expect(resolver.listConnectionTables({ ctx })).resolves.toEqual([]);
      expect(getProjectConnectionTables).not.toHaveBeenCalled();
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          resourceType: 'knowledge_base',
          resourceId: 'kb-1',
          result: 'allowed',
          payloadJson: {
            operation: 'list_data_source_tables',
          },
        }),
      );
    });

    it('lists connection tables through the linked knowledge base runtime project in draft canonical scope', async () => {
      const resolver = new ProjectController();
      const getProjectById = jest.fn().mockResolvedValue({
        id: 42,
        type: 'POSTGRES',
      });
      const getProjectConnectionTables = jest
        .fn()
        .mockResolvedValue([{ name: 'orders' }]);
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', runtimeProjectId: 42 },
          deployment: null,
          selector: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
          },
        },
        projectService: {
          getProjectById,
          getProjectConnectionTables,
        },
      });

      await expect(resolver.listConnectionTables({ ctx })).resolves.toEqual([
        { name: 'orders' },
      ]);

      expect(getProjectById).toHaveBeenCalledWith(42);
      expect(getProjectConnectionTables).toHaveBeenCalledWith({
        id: 42,
        type: 'POSTGRES',
      });
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          resourceType: 'project',
          resourceId: '42',
          result: 'allowed',
          payloadJson: {
            operation: 'list_data_source_tables',
          },
        }),
      );
    });

    it('records allowed audit when fetching schema change summary', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42, type: 'POSTGRES' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
        },
        schemaChangeRepository: {
          findLastSchemaChange: jest.fn().mockResolvedValue(null),
        },
      });

      await expect(resolver.getSchemaChange({ ctx })).resolves.toEqual({
        deletedTables: null,
        deletedColumns: null,
        modifiedColumns: null,
        lastSchemaChangeTime: null,
      });

      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          resourceType: 'project',
          resourceId: '42',
          result: 'allowed',
          payloadJson: {
            operation: 'get_schema_change',
          },
        }),
      );
    });

    it('returns an empty schema change summary when workspace scope has no active runtime project yet', async () => {
      const resolver = new ProjectController();
      const findLastSchemaChange = jest.fn();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          deployment: null,
        },
        schemaChangeRepository: {
          findLastSchemaChange,
        },
      });

      await expect(resolver.getSchemaChange({ ctx })).resolves.toEqual({
        deletedTables: null,
        deletedColumns: null,
        modifiedColumns: null,
        lastSchemaChangeTime: null,
      });

      expect(findLastSchemaChange).not.toHaveBeenCalled();
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          resourceType: 'knowledge_base',
          resourceId: 'kb-1',
          result: 'allowed',
          payloadJson: {
            operation: 'get_schema_change',
          },
        }),
      );
    });
  });
});
