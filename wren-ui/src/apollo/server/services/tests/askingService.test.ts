import { AskingService, constructCteSql } from '../askingService';
import {
  RecommendationQuestionStatus,
  SkillResultType,
} from '../../models/adaptor';

describe('AskingService', () => {
  describe('utility: constructCteSql', () => {
    test('oneline sql', () => {
      const sql = 'SELECT * FROM test';
      const steps = [{ sql, summary: 'test', cteName: '' }];
      const result = constructCteSql(steps);
      expect(result).toBe(`-- test\nSELECT * FROM test`);
    });

    test('2 steps of sql', () => {
      const steps = [
        {
          sql: 'SELECT * FROM test',
          summary: 'test1 summary',
          cteName: 'test1',
        },
        { sql: 'SELECT * FROM test2', summary: 'test2', cteName: '' },
      ];
      const result = constructCteSql(steps);
      expect(result).toBe(
        `WITH test1 AS\n-- test1 summary\n(SELECT * FROM test)\n-- test2\nSELECT * FROM test2`,
      );
    });

    test('3 steps of sql', () => {
      const steps = [
        {
          sql: 'SELECT * FROM test',
          summary: 'test1 summary',
          cteName: 'test1',
        },
        {
          sql: 'SELECT * FROM test2',
          summary: 'test2 summary',
          cteName: 'test2',
        },
        { sql: 'SELECT * FROM test3', summary: 'test3', cteName: '' },
      ];
      const result = constructCteSql(steps);
      expect(result).toBe(
        `WITH test1 AS\n-- test1 summary\n(SELECT * FROM test),` +
          `test2 AS\n-- test2 summary\n(SELECT * FROM test2)\n-- test3\nSELECT * FROM test3`,
      );
    });

    test('2 steps of sql with stepIndex=0', () => {
      const steps = [
        {
          sql: 'SELECT * FROM test',
          summary: 'test1 summary',
          cteName: 'test1',
        },
        { sql: 'SELECT * FROM test2', summary: 'test2', cteName: '' },
      ];
      const result = constructCteSql(steps, 0);
      expect(result).toBe(`-- test1 summary\nSELECT * FROM test`);
    });

    test('2 steps of sql with stepIndex=1', () => {
      const steps = [
        {
          sql: 'SELECT * FROM test',
          summary: 'test1 summary',
          cteName: 'test1',
        },
        { sql: 'SELECT * FROM test2', summary: 'test2', cteName: '' },
      ];
      const result = constructCteSql(steps, 1);
      expect(result).toBe(
        `WITH test1 AS\n-- test1 summary\n(SELECT * FROM test)\n-- test2\nSELECT * FROM test2`,
      );
    });

    test('3 steps of sql with stepIndex=1', () => {
      const steps = [
        {
          sql: 'SELECT * FROM test',
          summary: 'test1 summary',
          cteName: 'test1',
        },
        {
          sql: 'SELECT * FROM test2',
          summary: 'test2 summary',
          cteName: 'test2',
        },
        { sql: 'SELECT * FROM test3', summary: 'test3', cteName: '' },
      ];
      const result = constructCteSql(steps, 1);
      expect(result).toBe(
        `WITH test1 AS\n-- test1 summary\n(SELECT * FROM test)` +
          `\n-- test2 summary\nSELECT * FROM test2`,
      );
    });
  });

  describe('createThread', () => {
    it('persists runtime identity when creating a thread', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        createOne: jest.fn().mockResolvedValue({
          id: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      };
      service.threadResponseRepository = {
        createOne: jest.fn().mockResolvedValue({ id: 202 }),
      };
      service.askingTaskTracker = {
        bindThreadResponse: jest.fn(),
      };

      const runtimeIdentity = {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      };

      await service.createThread(
        {
          question: 'what happened yesterday',
          trackedAskingResult: {
            taskId: 9,
            queryId: 'query-9',
          },
        },
        runtimeIdentity,
      );

      expect(service.threadRepository.createOne).toHaveBeenCalledWith({
        ...runtimeIdentity,
        summary: 'what happened yesterday',
      });
      expect(service.threadResponseRepository.createOne).toHaveBeenCalledWith({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
        threadId: 101,
        question: 'what happened yesterday',
        sql: undefined,
        askingTaskId: 9,
        skillResult: null,
      });
      expect(service.askingTaskTracker.bindThreadResponse).toHaveBeenCalledWith(
        9,
        'query-9',
        101,
        202,
      );
    });
  });

  describe('createThreadResponse', () => {
    it('inherits runtime identity from the parent thread', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      };
      service.threadResponseRepository = {
        createOne: jest.fn().mockResolvedValue({ id: 202 }),
      };
      service.askingTaskTracker = {
        bindThreadResponse: jest.fn(),
      };

      await service.createThreadResponse(
        {
          question: 'follow up',
          trackedAskingResult: {
            taskId: 9,
            queryId: 'query-9',
          },
        },
        101,
      );

      expect(service.threadResponseRepository.createOne).toHaveBeenCalledWith({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
        threadId: 101,
        question: 'follow up',
        sql: undefined,
        askingTaskId: 9,
        skillResult: null,
      });
    });

    it('persists skill results onto thread responses when present', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      };
      service.threadResponseRepository = {
        createOne: jest.fn().mockResolvedValue({ id: 202 }),
      };
      service.askingTaskTracker = {
        bindThreadResponse: jest.fn(),
      };

      const skillResult = {
        resultType: SkillResultType.TEXT,
        text: '本月 GMV 为 128 万',
      };

      await service.createThreadResponse(
        {
          question: 'follow up',
          trackedAskingResult: {
            taskId: 9,
            queryId: 'query-9',
            skillResult,
          },
        },
        101,
      );

      expect(service.threadResponseRepository.createOne).toHaveBeenCalledWith({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
        threadId: 101,
        question: 'follow up',
        sql: undefined,
        askingTaskId: 9,
        skillResult,
      });
    });
  });

  describe('createAskingTask', () => {
    it('reuses persisted thread runtime identity for follow-up asks', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-1' }),
      };
      service.getAskingHistory = jest.fn().mockResolvedValue([]);
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeployment: jest.fn(),
      };

      await service.createAskingTask(
        { question: 'follow up' },
        {
          threadId: 101,
          projectId: 999,
          workspaceId: 'workspace-other',
          knowledgeBaseId: 'kb-other',
          kbSnapshotId: 'snapshot-other',
          deployHash: 'deploy-other',
          actorUserId: 'user-other',
          language: 'en',
        },
      );

      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith({
        query: 'follow up',
        histories: [],
        deployId: 'deploy-1',
        configurations: { language: 'en' },
        rerunFromCancelled: undefined,
        previousTaskId: undefined,
        threadResponseId: undefined,
        runtimeIdentity: {
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
      });
      expect(service.deployService.getLastDeployment).not.toHaveBeenCalled();
    });
  });

  describe('listThreads', () => {
    it('filters threads by runtime identity', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        listAllTimeDescOrder: jest.fn().mockResolvedValue([
          {
            id: 1,
            projectId: 42,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
          },
          {
            id: 2,
            projectId: 42,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-2',
            kbSnapshotId: 'snapshot-2',
            deployHash: 'deploy-2',
          },
          {
            id: 3,
            projectId: 42,
            workspaceId: null,
            knowledgeBaseId: null,
            kbSnapshotId: null,
            deployHash: null,
          },
        ]),
      };

      const threads = await service.listThreads({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      });

      expect(threads.map((thread) => thread.id)).toEqual([1, 3]);
    });
  });

  describe('scope guard', () => {
    it('rejects thread access outside current runtime scope', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snapshot-2',
          deployHash: 'deploy-2',
        }),
      };

      await expect(
        service.assertThreadScope(101, {
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(
        'Thread 101 does not belong to the current runtime scope',
      );
    });

    it('rejects asking task access outside current runtime scope', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.askingTaskRepository = {
        findByQueryId: jest.fn().mockResolvedValue({
          id: 303,
          queryId: 'query-1',
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snapshot-2',
          deployHash: 'deploy-2',
        }),
      };

      await expect(
        service.assertAskingTaskScope('query-1', {
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(
        'Asking task query-1 does not belong to the current runtime scope',
      );
    });

    it('rejects response access outside current runtime scope', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadResponseRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 202,
          threadId: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snapshot-2',
          deployHash: 'deploy-2',
        }),
      };

      await expect(
        service.assertResponseScope(202, {
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(
        'Thread response 202 does not belong to the current runtime scope',
      );
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
        getLastDeployment: jest
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
      );

      expect(result).toEqual({ id: 'instant-1' });
      expect(service.instantRecommendedQuestionTasks.get('instant-1')).toEqual(
        expect.objectContaining({
          runtimeIdentity,
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

    it('cleans tracked instant recommended questions after final result', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.instantRecommendedQuestionTasks = new Map([
        [
          'instant-1',
          {
            runtimeIdentity,
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
