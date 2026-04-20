import { AskingService, RecommendQuestionResultStatus } from '../askingService';
import {
  RecommendationQuestionStatus,
  WrenAILanguage,
} from '../../models/adaptor';

describe('AskingService', () => {
  describe('thread recommended questions', () => {
    it('uses the thread runtime deployment when generating recommended questions', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-thread',
          actorUserId: 'user-1',
        }),
        updateOne: jest.fn().mockResolvedValue({
          id: 101,
          queryId: 'recommend-1',
          questionsStatus: RecommendationQuestionStatus.GENERATING,
          questions: [],
          questionsError: null,
        }),
      };
      service.threadResponseRepository = {
        findAllBy: jest.fn().mockResolvedValue([
          { id: 1, question: 'q1' },
          { id: 2, question: 'q2' },
        ]),
      };
      service.projectService = {
        getProjectById: jest.fn().mockResolvedValue({
          id: 42,
          language: 'EN',
        }),
      };
      service.deployService = {
        getDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ manifest: { models: ['thread'] } }),
      };
      service.wrenAIAdaptor = {
        generateRecommendationQuestions: jest
          .fn()
          .mockResolvedValue({ queryId: 'recommend-1' }),
      };
      service.threadRecommendQuestionBackgroundTracker = {
        isExist: jest.fn().mockReturnValue(false),
        addTask: jest.fn(),
      };
      service.getProjectAndDeployment =
        AskingService.prototype['getProjectAndDeployment'].bind(service);
      service.getThreadRecommendationQuestionsConfig =
        AskingService.prototype['getThreadRecommendationQuestionsConfig'].bind(
          service,
        );

      await service.generateThreadRecommendationQuestions(101, '4');

      expect(
        service.deployService.getDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: null,
          deployHash: 'deploy-thread',
        }),
      );
      expect(
        service.wrenAIAdaptor.generateRecommendationQuestions,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          manifest: { models: ['thread'] },
          runtimeScopeId: '4',
          configuration: {
            language: WrenAILanguage.ZH_CN,
          },
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-thread',
            actorUserId: 'user-1',
          },
          previousQuestions: ['q2', 'q1'],
        }),
      );
    });

    it('regenerates finished thread recommendations when Chinese is preferred but cached questions are non-Chinese', async () => {
      const service = Object.create(AskingService.prototype) as any;
      const thread = {
        id: 101,
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-thread',
        actorUserId: 'user-1',
        queryId: 'recommend-1',
        questionsStatus: RecommendationQuestionStatus.FINISHED,
        questions: [
          {
            category: 'Comparative Questions',
            question:
              'How does the scoring distribution differ by home/away games?',
            sql: 'select 1',
          },
        ],
        questionsError: null,
      };
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue(thread),
      };
      service.knowledgeBaseRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 'kb-1',
          language: null,
        }),
      };
      service.getExecutionResources = jest.fn().mockResolvedValue({
        project: { id: 42, language: 'EN' },
      });
      service.generateThreadRecommendationQuestions = jest
        .fn()
        .mockResolvedValue(undefined);
      service.isLikelyNonChineseQuestions =
        AskingService.prototype['isLikelyNonChineseQuestions'].bind(service);
      service.shouldForceChineseThreadRecommendation =
        AskingService.prototype['shouldForceChineseThreadRecommendation'].bind(
          service,
        );

      const result = await service.getThreadRecommendationQuestions(101);

      expect(
        service.generateThreadRecommendationQuestions,
      ).toHaveBeenCalledWith(101);
      expect(result).toEqual({
        status: RecommendQuestionResultStatus.GENERATING,
        questions: [],
        error: undefined,
      });
    });
  });

  describe('getResponsesWithThreadScoped', () => {
    it('loads responses by runtime scope after thread scope passes', async () => {
      const service = Object.create(AskingService.prototype) as any;
      const runtimeIdentity = {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      };
      const normalizedRuntimeIdentity = {
        ...runtimeIdentity,
        projectId: null,
      };
      service.assertThreadScope = jest.fn().mockResolvedValue({
        id: 101,
      });
      service.threadResponseRepository = {
        getResponsesWithThreadByScope: jest
          .fn()
          .mockResolvedValue([{ id: 201, threadId: 101, sql: 'select 1' }]),
      };
      service.getResponsesWithThread =
        AskingService.prototype['getResponsesWithThread'].bind(service);

      const responses = await service.getResponsesWithThreadScoped(
        101,
        runtimeIdentity,
      );

      expect(service.assertThreadScope).toHaveBeenCalledWith(
        101,
        runtimeIdentity,
      );
      expect(
        service.threadResponseRepository.getResponsesWithThreadByScope,
      ).toHaveBeenCalledWith(101, normalizedRuntimeIdentity);
      expect(responses).toEqual([{ id: 201, threadId: 101, sql: 'select 1' }]);
    });
  });

  describe('instant recommended questions scope tracking', () => {
    const runtimeIdentity = {
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    };

    it('tracks runtime identity when creating an instant recommended questions task', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.instantRecommendedQuestionTasks = new Map();
      service.projectService = {
        getProjectById: jest.fn().mockResolvedValue({
          id: 42,
          language: 'EN',
        }),
      };
      service.deployService = {
        getDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ manifest: { models: [] } }),
      };
      service.wrenAIAdaptor = {
        generateRecommendationQuestions: jest
          .fn()
          .mockResolvedValue({ queryId: 'instant-1' }),
      };
      service.getThreadRecommendationQuestionsConfig =
        AskingService.prototype['getThreadRecommendationQuestionsConfig'].bind(
          service,
        );
      service['trackInstantRecommendedQuestionTask'] =
        AskingService.prototype['trackInstantRecommendedQuestionTask'].bind(
          service,
        );

      const result = await service.createInstantRecommendedQuestions(
        { previousQuestions: ['q0'] },
        runtimeIdentity,
        '4',
      );

      expect(result).toEqual({ id: 'instant-1' });
      expect(
        service.wrenAIAdaptor.generateRecommendationQuestions,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeScopeId: '4',
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
            actorUserId: 'user-1',
          },
        }),
      );
      expect(service.instantRecommendedQuestionTasks.get('instant-1')).toEqual(
        expect.objectContaining({
          runtimeIdentity: {
            ...runtimeIdentity,
            projectId: null,
          },
        }),
      );
      expect(
        service.deployService.getDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: null,
          deployHash: 'deploy-1',
        }),
      );
    });

    it('falls back to the latest deployment when instant recommended questions have no persisted deploy hash', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.instantRecommendedQuestionTasks = new Map();
      service.projectService = {
        getProjectById: jest.fn().mockResolvedValue({
          id: 42,
          language: 'EN',
        }),
      };
      service.deployService = {
        getDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ manifest: { models: ['latest'] } }),
      };
      service.wrenAIAdaptor = {
        generateRecommendationQuestions: jest
          .fn()
          .mockResolvedValue({ queryId: 'instant-2' }),
      };
      service.getThreadRecommendationQuestionsConfig =
        AskingService.prototype['getThreadRecommendationQuestionsConfig'].bind(
          service,
        );
      service['trackInstantRecommendedQuestionTask'] =
        AskingService.prototype['trackInstantRecommendedQuestionTask'].bind(
          service,
        );

      const runtimeIdentityWithoutDeploy = {
        ...runtimeIdentity,
        deployHash: null,
      };

      const result = await service.createInstantRecommendedQuestions(
        { previousQuestions: ['q0'] },
        runtimeIdentityWithoutDeploy,
        '4',
      );

      expect(result).toEqual({ id: 'instant-2' });
      expect(
        service.wrenAIAdaptor.generateRecommendationQuestions,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeScopeId: '4',
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: null,
            actorUserId: 'user-1',
          },
        }),
      );
      expect(
        service.deployService.getDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 42,
          deployHash: null,
        }),
      );
    });

    it('rejects lookup when instant recommended questions task scope mismatches', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.instantRecommendedQuestionTasks = new Map([
        [
          'instant-1',
          {
            runtimeIdentity: {
              ...runtimeIdentity,
              knowledgeBaseId: 'kb-other',
            },
            createdAt: Date.now(),
          },
        ],
      ]);
      service.wrenAIAdaptor = {
        getRecommendationQuestionsResult: jest.fn(),
      };
      service['assertInstantRecommendedQuestionTaskScope'] =
        AskingService.prototype[
          'assertInstantRecommendedQuestionTaskScope'
        ].bind(service);

      await expect(
        service.getInstantRecommendedQuestions('instant-1', runtimeIdentity),
      ).rejects.toThrow('Instant recommended questions task not found');

      expect(
        service.wrenAIAdaptor.getRecommendationQuestionsResult,
      ).not.toHaveBeenCalled();
    });

    it('accepts lookup when tracked instant task uses legacy-null project bridge but other runtime fields match', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.instantRecommendedQuestionTasks = new Map([
        [
          'instant-1',
          {
            runtimeIdentity: {
              ...runtimeIdentity,
              projectId: null,
            },
            createdAt: Date.now(),
          },
        ],
      ]);
      service.wrenAIAdaptor = {
        getRecommendationQuestionsResult: jest.fn().mockResolvedValue({
          status: RecommendationQuestionStatus.FINISHED,
          response: { questions: ['q1'] },
          error: null,
        }),
      };
      service['assertInstantRecommendedQuestionTaskScope'] =
        AskingService.prototype[
          'assertInstantRecommendedQuestionTaskScope'
        ].bind(service);

      await expect(
        service.getInstantRecommendedQuestions('instant-1', runtimeIdentity),
      ).resolves.toEqual({
        status: RecommendationQuestionStatus.FINISHED,
        response: { questions: ['q1'] },
        error: null,
      });
      expect(
        service.wrenAIAdaptor.getRecommendationQuestionsResult,
      ).toHaveBeenCalledWith('instant-1');
    });

    it('cleans tracked instant recommended questions after final result', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.instantRecommendedQuestionTasks = new Map([
        [
          'instant-1',
          {
            runtimeIdentity: {
              ...runtimeIdentity,
              projectId: null,
            },
            createdAt: Date.now(),
          },
        ],
      ]);
      service.wrenAIAdaptor = {
        getRecommendationQuestionsResult: jest.fn().mockResolvedValue({
          status: RecommendationQuestionStatus.FINISHED,
          response: { questions: [] },
          error: null,
        }),
      };
      service['assertInstantRecommendedQuestionTaskScope'] =
        AskingService.prototype[
          'assertInstantRecommendedQuestionTaskScope'
        ].bind(service);

      await service.getInstantRecommendedQuestions(
        'instant-1',
        runtimeIdentity,
      );

      expect(service.instantRecommendedQuestionTasks.has('instant-1')).toBe(
        false,
      );
    });
  });
});
