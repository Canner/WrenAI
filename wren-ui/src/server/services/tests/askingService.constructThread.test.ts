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

  describe('createThread', () => {
    it('persists runtime identity when creating a thread', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        createOne: jest.fn().mockResolvedValue({
          id: 101,
          projectId: null,
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
        knowledgeBaseIds: ['kb-1'],
        projectId: null,
        selectedSkillIds: null,
        summary: 'what happened yesterday',
      });
      expect(service.threadResponseRepository.createOne).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
        threadId: 101,
        question: 'what happened yesterday',
        sql: undefined,
        askingTaskId: 9,
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
      });
    });
  });

  describe('previewData shaping', () => {
    it('applies chart preview shaping on the server and persists chart data profile', async () => {
      const service = Object.create(AskingService.prototype) as any;
      const runtimeIdentity = {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      };
      service.getResponse = jest.fn().mockResolvedValue({
        id: 55,
        sql: 'select * from sales',
        chartDetail: {
          chartSchema: {
            mark: 'bar',
            encoding: {
              x: { field: 'category', type: 'nominal' },
              y: { field: 'sales', type: 'quantitative' },
            },
          },
          renderHints: { preferredRenderer: 'svg' },
        },
      });
      service.getThreadResponseRuntimeIdentity = jest
        .fn()
        .mockResolvedValue(runtimeIdentity);
      service.getExecutionResources = jest.fn().mockResolvedValue({
        project: { id: 1, type: 'view' },
        manifest: '{}',
      });
      service.queryService = {
        preview: jest.fn().mockResolvedValue({
          columns: [
            { name: 'category', type: 'string' },
            { name: 'sales', type: 'number' },
          ],
          data: Array.from({ length: 30 }, (_, index) => [
            `c-${index}`,
            100 - index,
          ]),
        }),
      };
      service.threadResponseRepository = {
        updateOneByIdWithRuntimeScope: jest.fn().mockResolvedValue({ id: 55 }),
      };
      service.telemetry = {
        sendEvent: jest.fn(),
      };

      const result = await service.previewData(55, undefined, runtimeIdentity);

      expect(result.data).toHaveLength(26);
      expect(result.chartDataProfile).toMatchObject({
        sourceRowCount: 30,
        resultRowCount: 26,
      });
      expect(
        service.threadResponseRepository.updateOneByIdWithRuntimeScope,
      ).toHaveBeenCalledWith(
        55,
        runtimeIdentity,
        expect.objectContaining({
          chartDetail: expect.objectContaining({
            chartDataProfile: expect.objectContaining({
              sourceRowCount: 30,
              resultRowCount: 26,
            }),
            renderHints: expect.objectContaining({
              categoryCount: 30,
              isLargeCategory: true,
            }),
          }),
        }),
      );
    });
  });
});
