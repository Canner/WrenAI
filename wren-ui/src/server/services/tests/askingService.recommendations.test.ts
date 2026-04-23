import { AskingService } from '../askingService';
import { RecommendationQuestionStatus } from '../../models/adaptor';
import { generateThreadResponseRecommendationsAction } from '../askingServiceRecommendationActions';
import { TelemetryEvent } from '../../telemetry/telemetry';

describe('AskingService', () => {
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
          regenerate: true,
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
          regenerate: true,
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

  describe('response-scoped recommendation follow-up', () => {
    it('passes source response artifacts and preview metadata into recommendation generation', async () => {
      const runtimeIdentity = {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      };
      const triggerResponse = {
        id: 55,
        threadId: 10,
        question: '平均薪资是多少？',
        sql: 'select dept_name, avg_salary from payroll',
        responseKind: 'ASK',
        askingTask: {
          rephrasedQuestion: '各部门的平均薪资是多少？',
        },
        answerDetail: {
          content: '工程部门平均薪资最高，人力资源部门较低。',
        },
        chartDetail: {
          status: 'FINISHED',
          chartType: 'bar',
          chartSchema: {
            title: '部门平均薪资',
            encoding: {
              x: { field: 'dept_name' },
              y: { field: 'avg_salary' },
            },
          },
        },
      };

      const service = {
        getResponse: jest.fn().mockResolvedValue(triggerResponse),
        getThreadResponseRuntimeIdentity: jest
          .fn()
          .mockResolvedValue(runtimeIdentity),
        getExecutionResources: jest.fn().mockResolvedValue({
          project: { id: 42, language: 'EN' },
          manifest: { models: ['payroll'] },
        }),
        getAskingHistory: jest.fn().mockResolvedValue([
          {
            id: 21,
            question: '上一轮问题',
            sql: 'select 1',
            responseKind: 'ASK',
          },
        ]),
        previewDataScoped: jest.fn().mockResolvedValue({
          columns: [
            { name: 'dept_name', type: 'VARCHAR' },
            { name: 'avg_salary', type: 'DOUBLE' },
          ],
          data: [
            ['Engineering', 100],
            ['HR', 80],
          ],
        }),
        threadResponseRecommendQuestionBackgroundTracker: {
          isExist: jest.fn().mockReturnValue(false),
          addTask: jest.fn(),
        },
        telemetry: {
          sendEvent: jest.fn(),
        },
        threadResponseRepository: {
          updateOne: jest
            .fn()
            .mockImplementation(async (id: number, payload: any) => ({
              id,
              threadId: 10,
              recommendationDetail: payload.recommendationDetail,
            })),
        },
        createThreadResponse: jest.fn().mockResolvedValue({
          id: 77,
          threadId: 10,
          responseKind: 'RECOMMENDATION_FOLLOWUP',
          recommendationDetail: {
            status: RecommendationQuestionStatus.GENERATING,
            items: [],
            error: undefined,
            queryId: null,
            sourceResponseId: 55,
          },
        }),
        wrenAIAdaptor: {
          generateRecommendationQuestions: jest
            .fn()
            .mockResolvedValue({ queryId: 'recommend-77' }),
        },
        toAskRuntimeIdentity: jest.fn((identity) => identity),
        getThreadRecommendationQuestionsConfig: jest.fn().mockReturnValue({
          maxQuestions: 5,
          maxCategories: 3,
          regenerate: true,
        }),
      } as any;

      await generateThreadResponseRecommendationsAction(
        service,
        55,
        runtimeIdentity,
        {
          language: 'zh-CN',
          question: '推荐几个问题给我',
        },
        'runtime-scope-1',
      );

      expect(service.previewDataScoped).toHaveBeenCalledWith(
        55,
        runtimeIdentity,
        20,
      );
      expect(
        service.wrenAIAdaptor.generateRecommendationQuestions,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          manifest: { models: ['payroll'] },
          runtimeScopeId: 'runtime-scope-1',
          sourceQuestion: '各部门的平均薪资是多少？',
          sourceAnswer: expect.stringContaining('工程部门平均薪资最高'),
          sourceSql: 'select dept_name, avg_salary from payroll',
          sourceChartType: 'bar',
          sourceChartTitle: '部门平均薪资',
          sourceChartEncodings: ['x: dept_name', 'y: avg_salary'],
          sourceDimensionColumns: ['dept_name'],
          sourceMeasureColumns: ['avg_salary'],
          sourcePreviewColumnCount: 2,
          sourcePreviewRowCount: 2,
          sourceIntentLineage: ['ASK', 'CHART'],
          sourceResponseKind: 'ASK',
        }),
      );
      expect(
        service.threadResponseRecommendQuestionBackgroundTracker.addTask,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 77,
          recommendationDetail: expect.objectContaining({
            queryId: 'recommend-77',
            sourceResponseId: 55,
          }),
        }),
      );
      expect(service.telemetry.sendEvent).toHaveBeenCalledWith(
        TelemetryEvent.HOME_RECOMMENDATION_TRIGGER_SENT,
        expect.objectContaining({
          sourceResponseId: 55,
          sourceResponseKind: 'ASK',
          threadId: 10,
        }),
      );
      expect(service.telemetry.sendEvent).toHaveBeenCalledWith(
        TelemetryEvent.HOME_RECOMMENDATION_RESPONSE_CREATED,
        expect.objectContaining({
          responseId: 77,
          sourceResponseId: 55,
        }),
      );
    });

    it('uses an english follow-up title when the runtime language is english', async () => {
      const runtimeIdentity = {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      };

      const service = {
        getResponse: jest.fn().mockResolvedValue({
          id: 55,
          threadId: 10,
          question: 'What is the average salary?',
          sql: 'select avg_salary from payroll',
          responseKind: 'ASK',
        }),
        getThreadResponseRuntimeIdentity: jest
          .fn()
          .mockResolvedValue(runtimeIdentity),
        getExecutionResources: jest.fn().mockResolvedValue({
          project: { id: 42, language: 'EN' },
          manifest: { models: ['payroll'] },
        }),
        getAskingHistory: jest.fn().mockResolvedValue([]),
        previewDataScoped: jest.fn().mockResolvedValue({
          columns: [{ name: 'avg_salary', type: 'DOUBLE' }],
          data: [[100]],
        }),
        threadResponseRecommendQuestionBackgroundTracker: {
          isExist: jest.fn().mockReturnValue(false),
          addTask: jest.fn(),
        },
        telemetry: {
          sendEvent: jest.fn(),
        },
        threadResponseRepository: {
          updateOne: jest
            .fn()
            .mockImplementation(async (id: number, payload: any) => ({
              id,
              threadId: 10,
              recommendationDetail: payload.recommendationDetail,
            })),
        },
        createThreadResponse: jest.fn().mockResolvedValue({
          id: 78,
          threadId: 10,
          responseKind: 'RECOMMENDATION_FOLLOWUP',
          recommendationDetail: {
            status: RecommendationQuestionStatus.GENERATING,
            items: [],
            queryId: null,
            sourceResponseId: 55,
          },
        }),
        wrenAIAdaptor: {
          generateRecommendationQuestions: jest
            .fn()
            .mockResolvedValue({ queryId: 'recommend-78' }),
        },
        toAskRuntimeIdentity: jest.fn((identity) => identity),
        getThreadRecommendationQuestionsConfig: jest.fn().mockReturnValue({
          maxQuestions: 5,
          maxCategories: 3,
          regenerate: true,
        }),
      } as any;

      await generateThreadResponseRecommendationsAction(
        service,
        55,
        runtimeIdentity,
        {
          language: 'en-US',
        },
        'runtime-scope-1',
      );

      expect(service.createThreadResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          question: 'Recommend follow-up questions',
        }),
        10,
        runtimeIdentity,
      );
    });
  });
});
