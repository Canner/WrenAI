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
});
