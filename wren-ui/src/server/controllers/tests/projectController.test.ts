import {
  MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE,
  ProjectController,
} from '../projectController';
import { DataSourceName, RelationType } from '../../types';

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

  describe('getProjectRecommendationQuestions', () => {
    it('falls back to deployment project id when runtime scope project is absent', async () => {
      const resolver = new ProjectController();
      const getProjectRecommendationQuestions = jest.fn().mockResolvedValue({
        status: 'NOT_STARTED',
        questions: [],
        error: null,
      });

      const result = await resolver.getProjectRecommendationQuestions(
        null,
        null,
        withAuthorizedContext({
          runtimeScope: {
            project: null,
            deployment: { projectId: 42 },
          },
          projectService: {
            getProjectById: jest.fn().mockResolvedValue({ id: 42 }),
            getProjectRecommendationQuestions,
          },
        }),
      );

      expect(getProjectRecommendationQuestions).toHaveBeenCalledWith(42);
      expect(result).toEqual({
        status: 'NOT_STARTED',
        questions: [],
        error: null,
      });
    });

    it('prefers runtime scope project id', async () => {
      const resolver = new ProjectController();
      const getCurrentProject = jest.fn();
      const getProjectRecommendationQuestions = jest.fn().mockResolvedValue({
        status: 'NOT_STARTED',
        questions: [],
        error: null,
      });

      const result = await resolver.getProjectRecommendationQuestions(
        null,
        null,
        withAuthorizedContext({
          runtimeScope: {
            project: { id: 42 },
          },
          projectService: {
            getCurrentProject,
            getProjectRecommendationQuestions,
          },
        }),
      );

      expect(getCurrentProject).not.toHaveBeenCalled();
      expect(getProjectRecommendationQuestions).toHaveBeenCalledWith(42);
      expect(result).toEqual({
        status: 'NOT_STARTED',
        questions: [],
        error: null,
      });
    });

    it('returns an empty recommendation payload when workspace scope has no active runtime project yet', async () => {
      const resolver = new ProjectController();
      const getProjectRecommendationQuestions = jest.fn();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          deployment: null,
        },
        projectService: {
          getProjectRecommendationQuestions,
        },
      });

      const result = await resolver.getProjectRecommendationQuestions(
        null,
        null,
        ctx,
      );

      expect(result).toEqual({
        status: 'NOT_STARTED',
        questions: [],
        error: null,
      });
      expect(getProjectRecommendationQuestions).not.toHaveBeenCalled();
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          resourceType: 'knowledge_base',
          resourceId: 'kb-1',
          result: 'allowed',
          payloadJson: {
            operation: 'get_project_recommendation_questions',
          },
        }),
      );
    });

    it('requires an authenticated readable scope when runtime scope is missing', async () => {
      const resolver = new ProjectController();
      const getProjectRecommendationQuestions = jest
        .fn()
        .mockResolvedValue({ status: 'FINISHED', questions: [], error: null });

      await expect(
        resolver.getProjectRecommendationQuestions(null, null, {
          runtimeScope: null,
          projectService: {
            getCurrentProject: jest.fn(),
            getProjectRecommendationQuestions,
          },
        } as any),
      ).rejects.toThrow('Authentication required');

      expect(getProjectRecommendationQuestions).not.toHaveBeenCalled();
    });

    it('rejects project recommendation reads in binding-only mode without granted actions', async () => {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
      const resolver = new ProjectController();
      const getProjectRecommendationQuestions = jest.fn();

      await expect(
        resolver.getProjectRecommendationQuestions(
          null,
          null,
          withAuthorizedContext({
            runtimeScope: {
              project: { id: 42 },
              workspace: { id: 'workspace-1' },
              knowledgeBase: { id: 'kb-1' },
            },
            authorizationActor: {
              ...createAuthorizationActor(),
              workspaceRoleKeys: ['owner'],
              permissionScopes: ['workspace:*'],
              grantedActions: [],
              workspaceRoleSource: 'legacy',
              platformRoleSource: 'legacy',
            },
            projectService: {
              getProjectRecommendationQuestions,
            },
          }),
        ),
      ).rejects.toThrow('Knowledge base read permission required');

      expect(getProjectRecommendationQuestions).not.toHaveBeenCalled();
    });
  });

  describe('scoped read requirements', () => {
    it('rejects getSettings when runtime scope is missing', async () => {
      const resolver = new ProjectController();
      const ctx = {
        runtimeScope: null,
        config: {},
        projectService: {
          getGeneralConnectionInfo: jest.fn(),
        },
      } as any;

      await expect(resolver.getSettings({ ctx })).rejects.toThrow(
        'Active runtime project is required for this operation',
      );

      expect(
        ctx.projectService.getGeneralConnectionInfo,
      ).not.toHaveBeenCalled();
    });

    it('returns workspace-scoped settings when active runtime project is not resolved yet', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          workspace: { id: 'workspace-1', kind: 'team' },
          knowledgeBase: null,
          deployment: null,
          project: null,
        },
        config: {
          wrenProductVersion: '1.2.3',
        },
        projectService: {
          getGeneralConnectionInfo: jest.fn(),
        },
      });

      await expect(resolver.getSettings({ ctx })).resolves.toEqual({
        productVersion: '1.2.3',
        dataSource: null,
        language: null,
      });

      expect(
        ctx.projectService.getGeneralConnectionInfo,
      ).not.toHaveBeenCalled();
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          result: 'allowed',
          resourceType: 'workspace',
          resourceId: 'workspace-1',
          payloadJson: {
            operation: 'get_settings',
          },
        }),
      );
    });

    it('resolves onboarding status from deployment project when runtime scope project is absent', async () => {
      const resolver = new ProjectController();
      const findAllBy = jest.fn().mockResolvedValue([]);
      const createOne = jest.fn();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          knowledgeBase: {
            id: 'kb-1',
            defaultKbSnapshotId: 'snapshot-1',
          },
          deployment: { projectId: 42 },
        },
        auditEventRepository: { createOne },
        projectService: {
          getProjectById: jest.fn().mockResolvedValue({
            id: 42,
            sampleDataset: null,
          }),
        },
        modelRepository: {
          findAllBy,
        },
      });

      await expect(resolver.getOnboardingStatus({ ctx })).resolves.toEqual({
        status: 'DATASOURCE_SAVED',
      });
      expect(ctx.projectService.getProjectById).toHaveBeenCalledWith(42);
      expect(findAllBy).toHaveBeenCalledWith({ projectId: 42 });
      expect(createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          resourceType: 'knowledge_base',
          resourceId: 'kb-1',
          result: 'allowed',
          payloadJson: { operation: 'get_onboarding_status' },
        }),
      );
    });

    it('prefers runtime knowledge base sample dataset when resolving onboarding status', async () => {
      const resolver = new ProjectController();
      const findAllBy = jest.fn();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42, sampleDataset: null },
          workspace: { id: 'workspace-1' },
          knowledgeBase: {
            id: 'kb-1',
            sampleDataset: 'ECOMMERCE',
          },
        },
        modelRepository: {
          findAllBy,
        },
      });

      await expect(resolver.getOnboardingStatus({ ctx })).resolves.toEqual({
        status: 'WITH_SAMPLE_DATASET',
      });
      expect(findAllBy).not.toHaveBeenCalled();
    });

    it('treats a connector-backed knowledge base without project bridge as datasource saved', async () => {
      const resolver = new ProjectController();
      const findAllBy = jest.fn();
      const createOne = jest.fn();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          knowledgeBase: {
            id: 'kb-1',
            primaryConnectorId: 'connector-1',
            sampleDataset: null,
          },
        },
        auditEventRepository: { createOne },
        modelRepository: {
          findAllBy,
        },
      });

      await expect(resolver.getOnboardingStatus({ ctx })).resolves.toEqual({
        status: 'DATASOURCE_SAVED',
      });
      expect(findAllBy).not.toHaveBeenCalled();
      expect(createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          resourceType: 'knowledge_base',
          resourceId: 'kb-1',
          result: 'allowed',
          payloadJson: { operation: 'get_onboarding_status' },
        }),
      );
    });

    it('rejects onboarding status reads in binding-only mode without granted actions', async () => {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
      const resolver = new ProjectController();
      const findAllBy = jest.fn();

      await expect(
        resolver.getOnboardingStatus({
          ctx: withAuthorizedContext({
            runtimeScope: {
              project: { id: 42, sampleDataset: null },
              workspace: { id: 'workspace-1' },
              knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
            },
            authorizationActor: {
              ...createAuthorizationActor(),
              grantedActions: [],
              workspaceRoleSource: 'legacy',
              platformRoleSource: 'legacy',
            },
            modelRepository: { findAllBy },
          }),
        }),
      ).rejects.toThrow('Knowledge base read permission required');

      expect(findAllBy).not.toHaveBeenCalled();
    });
  });

  describe('saveRelations', () => {
    it('rejects relation saves when referenced models are outside the active project', async () => {
      const resolver = new ProjectController();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42 },
        },
        telemetry: { sendEvent: jest.fn() },
        modelService: {
          getModelsByRuntimeIdentity: jest.fn().mockResolvedValue([]),
          saveRelations: jest.fn(),
          saveRelationsByRuntimeIdentity: jest.fn(),
        },
      });

      await expect(
        resolver.saveRelations(
          null,
          {
            data: {
              relations: [
                {
                  fromModelId: 1,
                  fromColumnId: 11,
                  toModelId: 2,
                  toColumnId: 22,
                  type: RelationType.ONE_TO_MANY,
                },
              ],
            },
          },
          ctx,
        ),
      ).rejects.toThrow('Relation model not found in active project');

      expect(ctx.modelService.saveRelations).not.toHaveBeenCalled();
      expect(
        ctx.modelService.saveRelationsByRuntimeIdentity,
      ).not.toHaveBeenCalled();
    });

    it('persists imported relations with canonical runtime fields while preserving the bridge project for deploys', async () => {
      const resolver = new ProjectController();
      const recordKnowledgeBaseWriteAuditSpy = jest
        .spyOn(resolver as any, 'recordKnowledgeBaseWriteAudit')
        .mockResolvedValue(undefined);
      const assertKnowledgeBaseWriteAccessSpy = jest
        .spyOn(resolver as any, 'assertKnowledgeBaseWriteAccess')
        .mockResolvedValue(undefined);
      const snapshot = {
        id: 'snapshot-1',
        knowledgeBaseId: 'kb-1',
        snapshotKey: 'latest-executable-default',
        displayName: 'KB 默认快照',
        deployHash: 'deploy-2',
        status: 'active',
      };
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42 },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', workspaceId: 'workspace-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          userId: 'user-1',
        },
        telemetry: { sendEvent: jest.fn() },
        projectService: {
          getProjectById: jest.fn().mockResolvedValue({ id: 42 }),
        },
        mdlService: {
          makeCurrentModelMDL: jest.fn().mockResolvedValue({ manifest: {} }),
        },
        deployService: {
          deploy: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
          getLastDeploymentByRuntimeIdentity: jest.fn().mockResolvedValue({
            id: 7,
            projectId: 42,
            hash: 'deploy-2',
            kbSnapshotId: 'snapshot-1',
          }),
        },
        kbSnapshotRepository: {
          findOneBy: jest.fn().mockResolvedValue(snapshot),
          updateOne: jest.fn().mockResolvedValue(snapshot),
        },
        knowledgeBaseRepository: {
          updateOne: jest.fn().mockResolvedValue({
            id: 'kb-1',
            workspaceId: 'workspace-1',
            defaultKbSnapshotId: snapshot.id,
          }),
        },
        deployRepository: {
          updateOne: jest.fn(),
        },
        modelRepository: {
          findAllBy: jest.fn().mockResolvedValue([]),
        },
        relationRepository: {
          findAllBy: jest.fn().mockResolvedValue([]),
        },
        viewRepository: {
          findAllBy: jest.fn().mockResolvedValue([]),
        },
        modelService: {
          getModelsByRuntimeIdentity: jest.fn().mockResolvedValue([
            { id: 1, projectId: 42 },
            { id: 2, projectId: 42 },
          ]),
          saveRelations: jest.fn(),
          saveRelationsByRuntimeIdentity: jest
            .fn()
            .mockResolvedValue([{ id: 9 }]),
        },
      });

      await expect(
        resolver.saveRelations(
          null,
          {
            data: {
              relations: [
                {
                  fromModelId: 1,
                  fromColumnId: 11,
                  toModelId: 2,
                  toColumnId: 22,
                  type: RelationType.ONE_TO_MANY,
                },
              ],
            },
          },
          ctx,
        ),
      ).resolves.toEqual([{ id: 9 }]);

      expect(assertKnowledgeBaseWriteAccessSpy).toHaveBeenCalledWith(ctx);
      expect(
        ctx.modelService.saveRelationsByRuntimeIdentity,
      ).toHaveBeenCalledWith(
        {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        [
          {
            fromModelId: 1,
            fromColumnId: 11,
            toModelId: 2,
            toColumnId: 22,
            type: RelationType.ONE_TO_MANY,
          },
        ],
        {
          preserveProjectBridge: true,
        },
      );
      expect(ctx.modelService.saveRelations).not.toHaveBeenCalled();
      expect(recordKnowledgeBaseWriteAuditSpy).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          payloadJson: {
            operation: 'save_relations',
            relationCount: 1,
          },
        }),
      );
    });
  });

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
        dataSource: {
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
        dataSource: {
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
        dataSource: {
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

    it('records allowed audit when listing data source tables', async () => {
      const resolver = new ProjectController();
      const getProjectDataSourceTables = jest
        .fn()
        .mockResolvedValue([{ name: 'orders' }]);
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42, type: 'POSTGRES' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
        },
        projectService: {
          getProjectDataSourceTables,
        },
      });

      await expect(resolver.listDataSourceTables({ ctx })).resolves.toEqual([
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
      const getProjectDataSourceTables = jest.fn();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          deployment: null,
        },
        projectService: {
          getProjectDataSourceTables,
        },
      });

      await expect(resolver.listDataSourceTables({ ctx })).resolves.toEqual([]);
      expect(getProjectDataSourceTables).not.toHaveBeenCalled();
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

    it('lists data source tables through the linked knowledge base runtime project in draft canonical scope', async () => {
      const resolver = new ProjectController();
      const getProjectById = jest.fn().mockResolvedValue({
        id: 42,
        type: 'POSTGRES',
      });
      const getProjectDataSourceTables = jest
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
          getProjectDataSourceTables,
        },
      });

      await expect(resolver.listDataSourceTables({ ctx })).resolves.toEqual([
        { name: 'orders' },
      ]);

      expect(getProjectById).toHaveBeenCalledWith(42);
      expect(getProjectDataSourceTables).toHaveBeenCalledWith({
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

    it('rejects direct datasource edits for managed federated runtime projects', async () => {
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
        projectRepository: {
          updateOne: jest.fn(),
        },
        projectService: {
          getProjectDataSourceTables: jest.fn(),
        },
      });

      await expect(
        resolver.updateDataSource(
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
        ctx.projectService.getProjectDataSourceTables,
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
        projectService: {
          generateProjectRecommendationQuestions: jest
            .fn()
            .mockResolvedValue(undefined),
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
          delete: jest
            .fn()
            .mockRejectedValue(new Error('connection is lost')),
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
            dataSourceType: 'POSTGRES',
          },
        }),
      );
    });
  });

  describe('draft runtime project linkage', () => {
    it('links a newly saved data source project to the active knowledge base', async () => {
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
          getProjectDataSourceTables: jest
            .fn()
            .mockResolvedValue([{ name: 'orders' }]),
          getProjectDataSourceVersion: jest.fn().mockResolvedValue('15.0'),
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
        resolver.createProjectFromDataSource(
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
          getProjectDataSourceTables: jest.fn().mockResolvedValue([
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
          '系统样例已集中到系统样例空间，业务工作区不再支持导入样例数据，请直接连接真实数据源。',
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

      resolver.createProjectFromDataSource = jest
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
          getProjectDataSourceTables: jest
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

      expect(resolver.createProjectFromDataSource).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'DUCKDB',
        }),
        ctx,
      );
      expect(resolver.assertKnowledgeBaseWriteAccess).toHaveBeenCalledWith(ctx);
      expect(ctx.projectService.getCurrentProject).not.toHaveBeenCalled();
      expect(
        ctx.projectService.getProjectDataSourceTables,
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
