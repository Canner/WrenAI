import { AskingService, constructCteSql } from '../askingService';

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

  describe('project lookup for thread response', () => {
    test('falls back to current project when parent thread is missing', async () => {
      const currentProject = { id: 2, type: 'mssql' };
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue(null),
      };
      service.projectService = {
        getCurrentProject: jest.fn().mockResolvedValue(currentProject),
        getProjectById: jest.fn(),
      };

      const project = await service.getProjectForThreadResponse({
        id: 10,
        threadId: 530,
      });

      expect(project).toBe(currentProject);
      expect(service.projectService.getCurrentProject).toHaveBeenCalledTimes(1);
      expect(service.projectService.getProjectById).not.toHaveBeenCalled();
    });
  });

  describe('recommendation question shortcut SQL', () => {
    const trackedAskingResult = {
      taskId: 42,
      queryId: 'ask-query-id',
      question: 'Show monthly record count',
      status: 'UNDERSTANDING',
      response: null,
      error: null,
    };

    const createService = () => {
      const service = Object.create(AskingService.prototype) as any;
      service.projectService = {
        getCurrentProject: jest.fn().mockResolvedValue({
          id: 1,
          language: 'EN',
        }),
        getProjectById: jest.fn().mockResolvedValue({
          id: 1,
          language: 'EN',
        }),
      };
      service.deployService = {
        ensureDeploymentPrepared: jest
          .fn()
          .mockResolvedValue('latest-deploy-hash'),
      };
      service.threadRepository = {
        createOne: jest.fn().mockResolvedValue({ id: 7, projectId: 1 }),
        findOneBy: jest.fn().mockResolvedValue({ id: 7, projectId: 1 }),
      };
      service.threadResponseRepository = {
        createOne: jest.fn().mockResolvedValue({ id: 11, threadId: 7 }),
        getResponsesWithThread: jest.fn().mockResolvedValue([]),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({
          queryId: trackedAskingResult.queryId,
        }),
        getAskingResult: jest.fn().mockResolvedValue(trackedAskingResult),
        bindThreadResponse: jest.fn().mockResolvedValue(undefined),
      };
      return service;
    };

    test('creates a normal asking task for a new thread instead of storing shortcut SQL', async () => {
      const service = createService();

      await service.createThread({
        question: trackedAskingResult.question,
        sql: 'SELECT stale_recommendation_sql',
      });

      expect(service.deployService.ensureDeploymentPrepared).toHaveBeenCalledWith(1);
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith({
        query: trackedAskingResult.question,
        histories: null,
        deployId: 'latest-deploy-hash',
        projectId: '1',
        configurations: { language: 'EN' },
        rerunFromCancelled: undefined,
        previousTaskId: undefined,
        threadResponseId: undefined,
      });
      expect(service.threadResponseRepository.createOne).toHaveBeenCalledWith({
        threadId: 7,
        question: trackedAskingResult.question,
        sql: undefined,
        askingTaskId: trackedAskingResult.taskId,
      });
      expect(service.askingTaskTracker.bindThreadResponse).toHaveBeenCalledWith(
        trackedAskingResult.taskId,
        trackedAskingResult.queryId,
        7,
        11,
      );
    });

    test('creates a standalone asking task for current-thread recommendations', async () => {
      const service = createService();
      service.threadResponseRepository.getResponsesWithThread.mockResolvedValue([
        { id: 1, question: 'Previous question', sql: 'SELECT 1' },
      ]);

      await service.createThreadResponse(
        {
          question: trackedAskingResult.question,
          sql: 'SELECT stale_recommendation_sql',
        },
        7,
      );

      expect(service.projectService.getProjectById).toHaveBeenCalledWith(1);
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          query: trackedAskingResult.question,
          histories: null,
          deployId: 'latest-deploy-hash',
          projectId: '1',
          configurations: { language: 'EN' },
        }),
      );
      expect(
        service.threadResponseRepository.getResponsesWithThread,
      ).not.toHaveBeenCalled();
      expect(service.threadResponseRepository.createOne).toHaveBeenCalledWith({
        threadId: 7,
        question: trackedAskingResult.question,
        sql: undefined,
        askingTaskId: trackedAskingResult.taskId,
      });
    });
  });
});
