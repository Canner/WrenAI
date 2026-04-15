import {
  MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE,
  ProjectResolver,
} from '../projectResolver';
import { DataSourceName, RelationType } from '../../types';

describe('ProjectResolver', () => {
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
      const resolver = new ProjectResolver();
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
      const resolver = new ProjectResolver();
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

    it('requires an active runtime scope project', async () => {
      const resolver = new ProjectResolver();
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
      ).rejects.toThrow(
        'Active runtime project is required for this operation',
      );

      expect(getProjectRecommendationQuestions).not.toHaveBeenCalled();
    });

    it('rejects project recommendation reads in binding-only mode without granted actions', async () => {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
      const resolver = new ProjectResolver();
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
      const resolver = new ProjectResolver();
      const ctx = {
        runtimeScope: null,
        config: {},
        projectService: {
          getGeneralConnectionInfo: jest.fn(),
        },
      } as any;

      await expect(resolver.getSettings(null, null, ctx)).rejects.toThrow(
        'Active runtime project is required for this operation',
      );

      expect(
        ctx.projectService.getGeneralConnectionInfo,
      ).not.toHaveBeenCalled();
    });

    it('resolves onboarding status from deployment project when runtime scope project is absent', async () => {
      const resolver = new ProjectResolver();
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

      await expect(
        resolver.getOnboardingStatus(null, null, ctx),
      ).resolves.toEqual({
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
      const resolver = new ProjectResolver();
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

      await expect(
        resolver.getOnboardingStatus(null, null, ctx),
      ).resolves.toEqual({
        status: 'WITH_SAMPLE_DATASET',
      });
      expect(findAllBy).not.toHaveBeenCalled();
    });

    it('treats a connector-backed knowledge base without project bridge as datasource saved', async () => {
      const resolver = new ProjectResolver();
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

      await expect(
        resolver.getOnboardingStatus(null, null, ctx),
      ).resolves.toEqual({
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
      const resolver = new ProjectResolver();
      const findAllBy = jest.fn();

      await expect(
        resolver.getOnboardingStatus(
          null,
          null,
          withAuthorizedContext({
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
        ),
      ).rejects.toThrow('Knowledge base read permission required');

      expect(findAllBy).not.toHaveBeenCalled();
    });
  });

  describe('saveRelations', () => {
    it('rejects relation saves when referenced models are outside the active project', async () => {
      const resolver = new ProjectResolver();
      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42 },
        },
        telemetry: { sendEvent: jest.fn() },
        modelRepository: {
          findAllByIds: jest.fn().mockResolvedValue([
            { id: 1, projectId: 42 },
            { id: 2, projectId: 99 },
          ]),
        },
        modelService: {
          saveRelations: jest.fn(),
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
    });
  });

  describe('mutation scope requirements', () => {
    it('resolves settings from deployment project when runtime scope project is absent', async () => {
      const resolver = new ProjectResolver();
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

      await expect(resolver.getSettings(null, null, ctx)).resolves.toEqual({
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
      const resolver = new ProjectResolver();
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

      await expect(resolver.getSettings(null, null, ctx)).resolves.toEqual({
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
      const resolver = new ProjectResolver();
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

      await expect(resolver.getSettings(null, null, ctx)).resolves.toEqual({
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
      const resolver = new ProjectResolver();
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

      await expect(resolver.getSettings(null, null, ctx)).rejects.toThrow(
        'Knowledge base read permission required',
      );

      expect(
        ctx.projectService.getGeneralConnectionInfo,
      ).not.toHaveBeenCalled();
    });

    it('rejects updateCurrentProject when runtime scope is missing', async () => {
      const resolver = new ProjectResolver();
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
        resolver.updateCurrentProject(null, { data: { language: 'EN' } }, ctx),
      ).rejects.toThrow(
        'Active runtime project is required for this operation',
      );

      expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
      expect(
        ctx.projectService.generateProjectRecommendationQuestions,
      ).not.toHaveBeenCalled();
    });

    it('records allowed audit when listing data source tables', async () => {
      const resolver = new ProjectResolver();
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

      await expect(
        resolver.listDataSourceTables(null, null, ctx),
      ).resolves.toEqual([{ name: 'orders' }]);

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
      const resolver = new ProjectResolver();
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

      await expect(resolver.getSchemaChange(null, null, ctx)).resolves.toEqual({
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

    it('rejects direct datasource edits for managed federated runtime projects', async () => {
      const resolver = new ProjectResolver();
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
      const resolver = new ProjectResolver();
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
        resolver.updateCurrentProject(
          null,
          { data: { language: 'ZH_CN' } },
          ctx,
        ),
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
      const resolver = new ProjectResolver();
      const getCurrentProject = jest.fn();
      const ctx = withAuthorizedContext({
        runtimeScope: null,
        projectService: {
          getCurrentProject,
        },
      });

      await expect(resolver.resetCurrentProject(null, null, ctx)).resolves.toBe(
        true,
      );

      expect(getCurrentProject).not.toHaveBeenCalled();
    });

    it('passes runtime identity when deleting semantics during reset', async () => {
      const resolver = new ProjectResolver();
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

      await expect(resolver.resetCurrentProject(null, null, ctx)).resolves.toBe(
        true,
      );

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
      const resolver = new ProjectResolver() as any;
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
      const resolver = new ProjectResolver();
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

      await resolver.resetCurrentProject(null, null, ctx);

      const deleteArg = ctx.wrenAIAdaptor.delete.mock.calls[0][0];
      expect(deleteArg.runtimeIdentity).toMatchObject({
        deployHash: 'deploy-1',
      });
      expect(deleteArg.runtimeIdentity.projectId).toBeUndefined();
    });
  });

  describe('startSampleDataset', () => {
    it('reuses the newly created project instead of falling back to current project', async () => {
      const resolver = new ProjectResolver() as any;
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

      const ctx = withAuthorizedContext({
        runtimeScope: {
          project: { id: 42 },
          workspace: { id: 'workspace-1' },
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
