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
        connection: null,
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
        status: 'CONNECTION_SAVED',
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

    it('treats a connector-backed knowledge base without project bridge as connection saved', async () => {
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
        status: 'CONNECTION_SAVED',
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
});
