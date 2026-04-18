import {
  AskingService,
  RecommendQuestionResultStatus,
  constructCteSql,
} from '../askingService';
import {
  RecommendationQuestionStatus,
  WrenAILanguage,
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
        getLastDeploymentByRuntimeIdentity: jest.fn(),
      };

      await service.createAskingTask(
        { question: 'follow up' },
        {
          threadId: 101,
          runtimeIdentity: {
            projectId: 999,
            workspaceId: 'workspace-other',
            knowledgeBaseId: 'kb-other',
            kbSnapshotId: 'snapshot-other',
            deployHash: 'deploy-other',
            actorUserId: 'user-other',
          },
          language: 'en',
        },
      );

      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
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
          retrievalScopeIds: ['deploy-1'],
        }),
      );
      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).not.toHaveBeenCalled();
    });

    it('resolves deploy hash from payload runtime identity for first asks', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn(),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-2' }),
      };
      service.getAskingHistory = jest.fn();
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-2' }),
      };
      service.resolveAskingRuntimeIdentity =
        AskingService.prototype['resolveAskingRuntimeIdentity'].bind(service);

      await service.createAskingTask(
        { question: 'fresh ask' },
        {
          runtimeScopeId: 'legacy-runtime-42',
          runtimeIdentity: {
            projectId: 42,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            actorUserId: 'user-1',
          },
          language: 'en',
        },
      );

      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          actorUserId: 'user-1',
        }),
      );
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'fresh ask',
          histories: undefined,
          deployId: 'deploy-2',
          runtimeScopeId: 'legacy-runtime-42',
          configurations: { language: 'en' },
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-2',
            actorUserId: 'user-1',
          },
        }),
      );
    });

    it('pins runtime identity to selected knowledge base when scope is workspace-only', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn(),
      };
      service.askingTaskTracker = {
        createAskingTask: jest
          .fn()
          .mockResolvedValue({ queryId: 'query-workspace-scope' }),
      };
      service.getAskingHistory = jest.fn();
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.resolveAskingRuntimeIdentity =
        AskingService.prototype['resolveAskingRuntimeIdentity'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-kb-2' }),
      };
      service.skillService = {};

      await service.createAskingTask(
        {
          question: 'workspace scoped ask',
          knowledgeBaseIds: ['kb-2'],
        },
        {
          runtimeIdentity: {
            projectId: null,
            workspaceId: 'workspace-1',
            knowledgeBaseId: null,
            kbSnapshotId: null,
            deployHash: null,
            actorUserId: 'user-1',
          },
          language: 'zh-CN',
        },
      );

      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: null,
          deployHash: null,
          projectId: null,
        }),
      );
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          deployId: 'deploy-kb-2',
          runtimeScopeId: 'deploy-kb-2',
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-2',
            kbSnapshotId: null,
            deployHash: 'deploy-kb-2',
            actorUserId: 'user-1',
          },
          retrievalScopeIds: ['deploy-kb-2'],
        }),
      );
    });

    it('persists a placeholder asking task record immediately for first asks', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn(),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-2a' }),
      };
      service.askingTaskRepository = {
        findByQueryId: jest.fn().mockResolvedValue(null),
        createOne: jest.fn().mockResolvedValue({ id: 9, queryId: 'query-2a' }),
      };
      service.getAskingHistory = jest.fn();
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-2' }),
      };
      service.resolveAskingRuntimeIdentity =
        AskingService.prototype['resolveAskingRuntimeIdentity'].bind(service);

      await service.createAskingTask(
        { question: 'fresh ask' },
        {
          runtimeScopeId: 'legacy-runtime-42',
          runtimeIdentity: {
            projectId: 42,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            actorUserId: 'user-1',
          },
          language: 'en',
        },
      );

      expect(service.askingTaskRepository.findByQueryId).toHaveBeenCalledWith(
        'query-2a',
      );
      expect(service.askingTaskRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          queryId: 'query-2a',
          question: 'fresh ask',
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-2',
          detail: {
            type: null,
            status: 'UNDERSTANDING',
            response: [],
            error: null,
          },
        }),
      );
    });

    it('allows first asks to proceed with deployHash-only runtime identity', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn(),
      };
      service.askingTaskTracker = {
        createAskingTask: jest
          .fn()
          .mockResolvedValue({ queryId: 'query-deploy-only' }),
      };
      service.getAskingHistory = jest.fn();
      service.resolveAskingRuntimeIdentity =
        AskingService.prototype['resolveAskingRuntimeIdentity'].bind(service);
      service.skillService = {};

      await service.createAskingTask(
        { question: 'fresh ask with deploy only' },
        {
          runtimeIdentity: {
            projectId: 999,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-42',
            actorUserId: 'user-1',
          },
          language: 'en',
        },
      );

      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'fresh ask with deploy only',
          histories: undefined,
          deployId: 'deploy-42',
          runtimeScopeId: 'deploy-42',
          configurations: { language: 'en' },
          rerunFromCancelled: undefined,
          previousTaskId: undefined,
          threadResponseId: undefined,
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-42',
            actorUserId: 'user-1',
          },
          skills: [],
          retrievalScopeIds: ['deploy-42'],
        }),
      );
    });

    it('resolves first asks from canonical runtime scope without a project bridge when deployment history exists', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn(),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-5' }),
      };
      service.getAskingHistory = jest.fn();
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-runtime-1', projectId: 77 }),
      };
      service.resolveAskingRuntimeIdentity =
        AskingService.prototype['resolveAskingRuntimeIdentity'].bind(service);
      service.skillService = {};
      await service.createAskingTask(
        { question: 'fresh ask from runtime scope' },
        {
          runtimeIdentity: {
            projectId: null,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: null,
            actorUserId: 'user-1',
          },
          language: 'en',
        },
      );

      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
        actorUserId: 'user-1',
      });
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          deployId: 'deploy-runtime-1',
          runtimeScopeId: 'deploy-runtime-1',
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-runtime-1',
            actorUserId: 'user-1',
          },
        }),
      );
    });

    it('fails fast when canonical first asks have neither deployHash nor a legacy project bridge', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn(),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn(),
      };
      service.getAskingHistory = jest.fn();
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.resolveAskingRuntimeIdentity =
        AskingService.prototype['resolveAskingRuntimeIdentity'].bind(service);
      service.buildPersistedRuntimeIdentityPatch =
        AskingService.prototype['buildPersistedRuntimeIdentityPatch'].bind(
          service,
        );
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest.fn().mockResolvedValue(null),
      };

      await expect(
        service.createAskingTask(
          { question: 'fresh ask without deploy hash' },
          {
            runtimeIdentity: {
              projectId: null,
              workspaceId: 'workspace-1',
              knowledgeBaseId: 'kb-1',
              kbSnapshotId: 'snapshot-1',
              deployHash: null,
              actorUserId: 'user-1',
            },
            language: 'en',
          },
        ),
      ).rejects.toThrow(
        'No deployment found, please deploy your project first',
      );

      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
        actorUserId: 'user-1',
      });
      expect(service.askingTaskTracker.createAskingTask).not.toHaveBeenCalled();
    });

    it('uses thread runtime identity to resolve deployment for follow-up asks without persisted deploy hash', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: null,
          actorUserId: 'user-1',
        }),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-3' }),
      };
      service.getAskingHistory = jest.fn().mockResolvedValue([]);
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-3' }),
      };

      await service.createAskingTask(
        { question: 'follow up without deploy hash' },
        {
          threadId: 101,
          runtimeIdentity: {
            projectId: 999,
            workspaceId: 'workspace-other',
            knowledgeBaseId: 'kb-other',
            kbSnapshotId: 'snapshot-other',
            deployHash: 'deploy-other',
            actorUserId: 'user-other',
          },
          language: 'en',
        },
      );

      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          actorUserId: 'user-1',
        }),
      );
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          deployId: 'deploy-3',
          runtimeIdentity: expect.objectContaining({
            projectId: 42,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-3',
            actorUserId: 'user-1',
          }),
        }),
      );
    });

    it('falls back to payload runtime identity when follow-up thread uses legacy-null project bridge', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 101,
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: null,
          actorUserId: null,
        }),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-4' }),
      };
      service.getAskingHistory = jest.fn().mockResolvedValue([]);
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-4' }),
      };

      await service.createAskingTask(
        { question: 'follow up through legacy-null thread project' },
        {
          threadId: 101,
          runtimeIdentity: {
            projectId: 42,
            workspaceId: 'workspace-fallback',
            knowledgeBaseId: 'kb-fallback',
            kbSnapshotId: 'snapshot-fallback',
            deployHash: null,
            actorUserId: 'user-fallback',
          },
          language: 'en',
        },
      );

      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
        actorUserId: 'user-fallback',
      });
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          deployId: 'deploy-4',
          runtimeScopeId: 'deploy-4',
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-4',
            actorUserId: 'user-fallback',
          },
        }),
      );
    });
  });

  describe('thread response runtime identity', () => {
    it('fills missing response runtime fields from the parent thread', async () => {
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
      service.getThreadById =
        AskingService.prototype['getThreadById'].bind(service);
      service.getThreadResponseRuntimeIdentity =
        AskingService.prototype['getThreadResponseRuntimeIdentity'].bind(
          service,
        );

      const runtimeIdentity = await service.getThreadResponseRuntimeIdentity({
        id: 202,
        threadId: 101,
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
        actorUserId: null,
        question: 'follow up',
      });

      expect(runtimeIdentity).toEqual({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      });
    });

    it('falls back to the parent thread project identity when response uses legacy-null project bridge', async () => {
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
      };
      service.getThreadById =
        AskingService.prototype['getThreadById'].bind(service);
      service.getThreadResponseRuntimeIdentity =
        AskingService.prototype['getThreadResponseRuntimeIdentity'].bind(
          service,
        );

      const runtimeIdentity = await service.getThreadResponseRuntimeIdentity({
        id: 202,
        threadId: 101,
        projectId: null,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        actorUserId: null,
        question: 'follow up',
      });

      expect(runtimeIdentity).toEqual({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-thread',
        actorUserId: 'user-1',
      });
    });

    it('resolves project and deployment from deploy hash when runtime identity project bridge is absent', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.projectService = {
        getProjectById: jest
          .fn()
          .mockResolvedValue({ id: 42, type: 'POSTGRES' }),
      };
      service.deployService = {
        getDeploymentByRuntimeIdentity: jest.fn().mockResolvedValue({
          id: 12,
          projectId: 42,
          hash: 'deploy-42',
          manifest: { models: [] },
        }),
      };
      service.getProjectAndDeployment =
        AskingService.prototype['getProjectAndDeployment'].bind(service);

      await expect(
        service.getProjectAndDeployment({
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-42',
          actorUserId: 'user-1',
        }),
      ).resolves.toEqual({
        project: { id: 42, type: 'POSTGRES' },
        deployment: {
          id: 12,
          projectId: 42,
          hash: 'deploy-42',
          manifest: { models: [] },
        },
      });
      expect(
        service.deployService.getDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-42',
        actorUserId: 'user-1',
      });
      expect(service.projectService.getProjectById).toHaveBeenCalledWith(42);
    });

    it('rebuilds project metadata from deployment manifest when the project row is missing', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.projectService = {
        getProjectById: jest.fn().mockResolvedValue(null),
      };
      service.deployService = {
        getDeploymentByRuntimeIdentity: jest.fn().mockResolvedValue({
          id: 12,
          projectId: 42,
          hash: 'deploy-42',
          manifest: {
            catalog: 'wrenai',
            schema: 'public',
            dataSource: 'POSTGRES',
            models: [],
          },
        }),
      };
      service.buildManifestBackedProject =
        AskingService.prototype['buildManifestBackedProject'].bind(service);
      service.mapManifestDataSourceToProjectType =
        AskingService.prototype['mapManifestDataSourceToProjectType'].bind(
          service,
        );
      service.getProjectAndDeployment =
        AskingService.prototype['getProjectAndDeployment'].bind(service);

      await expect(
        service.getProjectAndDeployment({
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-42',
          actorUserId: 'user-1',
        }),
      ).resolves.toEqual({
        project: expect.objectContaining({
          id: 42,
          type: 'POSTGRES',
          catalog: 'wrenai',
          schema: 'public',
        }),
        deployment: {
          id: 12,
          projectId: 42,
          hash: 'deploy-42',
          manifest: {
            catalog: 'wrenai',
            schema: 'public',
            dataSource: 'POSTGRES',
            models: [],
          },
        },
      });
    });
  });

  describe('listThreads', () => {
    it('filters threads by runtime identity', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        listAllTimeDescOrderByScope: jest.fn().mockResolvedValue([
          {
            id: 1,
            projectId: 42,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
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

      expect(threads.map((thread: { id: number }) => thread.id)).toEqual([
        1, 3,
      ]);
      expect(
        service.threadRepository.listAllTimeDescOrderByScope,
      ).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      });
    });

    it('allows listing threads with deployHash-only runtime identity', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        listAllTimeDescOrderByScope: jest.fn().mockResolvedValue([]),
      };

      await service.listThreads({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      });

      expect(
        service.threadRepository.listAllTimeDescOrderByScope,
      ).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      });
    });
  });

  describe('scope guard', () => {
    it('rejects thread access outside current runtime scope', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneByIdWithRuntimeScope: jest.fn().mockResolvedValue(null),
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

    it('returns thread when repository scoped lookup succeeds', async () => {
      const service = Object.create(AskingService.prototype) as any;
      const thread = {
        id: 101,
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      };
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
      service.threadRepository = {
        findOneByIdWithRuntimeScope: jest.fn().mockResolvedValue(thread),
        findOneBy: jest.fn(),
      };

      await expect(
        service.assertThreadScope(101, runtimeIdentity),
      ).resolves.toEqual(thread);
      expect(
        service.threadRepository.findOneByIdWithRuntimeScope,
      ).toHaveBeenCalledWith(101, normalizedRuntimeIdentity);
      expect(service.threadRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('accepts thread access when repository matches runtime scope through legacy-null project bridge', async () => {
      const service = Object.create(AskingService.prototype) as any;
      const thread = {
        id: 101,
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      };
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
      service.threadRepository = {
        findOneByIdWithRuntimeScope: jest.fn().mockResolvedValue(thread),
        findOneBy: jest.fn(),
      };

      await expect(
        service.assertThreadScope(101, runtimeIdentity),
      ).resolves.toEqual(thread);
      expect(
        service.threadRepository.findOneByIdWithRuntimeScope,
      ).toHaveBeenCalledWith(101, normalizedRuntimeIdentity);
      expect(service.threadRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('accepts asking task access when repository matches runtime scope through legacy-null project bridge', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.askingTaskRepository = {
        findByQueryIdWithRuntimeScope: jest.fn().mockResolvedValue({
          id: 303,
          queryId: 'query-1',
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
        }),
        findByQueryId: jest.fn(),
      };

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

      await expect(
        service.assertAskingTaskScope('query-1', runtimeIdentity),
      ).resolves.toBeUndefined();
      expect(
        service.askingTaskRepository.findByQueryIdWithRuntimeScope,
      ).toHaveBeenCalledWith('query-1', normalizedRuntimeIdentity);
      expect(service.askingTaskRepository.findByQueryId).not.toHaveBeenCalled();
    });

    it('accepts asking task access when a newly created task is still only tracked in memory', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.askingTaskRepository = {
        findByQueryIdWithRuntimeScope: jest.fn().mockResolvedValue(null),
        findByQueryId: jest.fn().mockResolvedValue(null),
      };
      service.askingTaskTracker = {
        getTrackedRuntimeIdentity: jest.fn().mockResolvedValue({
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
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
      ).resolves.toBeUndefined();

      expect(
        service.askingTaskTracker.getTrackedRuntimeIdentity,
      ).toHaveBeenCalledWith('query-1');
      expect(service.askingTaskRepository.findByQueryId).not.toHaveBeenCalled();
    });

    it('rejects asking task access outside current runtime scope', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.askingTaskRepository = {
        findByQueryIdWithRuntimeScope: jest.fn().mockResolvedValue(null),
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
        findOneByIdWithRuntimeScope: jest.fn().mockResolvedValue(null),
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

    it('accepts response access when repository matches runtime scope through legacy-null project bridge', async () => {
      const service = Object.create(AskingService.prototype) as any;
      const response = {
        id: 202,
        threadId: 101,
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      };
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
      service.threadResponseRepository = {
        findOneByIdWithRuntimeScope: jest.fn().mockResolvedValue(response),
        findOneBy: jest.fn(),
      };

      await expect(
        service.assertResponseScope(202, runtimeIdentity),
      ).resolves.toEqual(response);
      expect(
        service.threadResponseRepository.findOneByIdWithRuntimeScope,
      ).toHaveBeenCalledWith(202, normalizedRuntimeIdentity);
      expect(service.threadResponseRepository.findOneBy).not.toHaveBeenCalled();
    });
  });

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

  describe('chart runtime scope forwarding', () => {
    const runtimeIdentity = {
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    };

    it('passes runtimeScopeId when generating thread response charts', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.assertResponseScope = jest.fn().mockResolvedValue(undefined);
      service.getExecutionResources = jest.fn().mockResolvedValue({
        project: { id: 42 },
        manifest: { models: [] },
      });
      service.queryService = {
        preview: jest.fn().mockResolvedValue({
          columns: [{ name: 'value', type: 'number' }],
          data: [[1]],
        }),
      };
      service.threadResponseRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 11,
          threadId: 9,
          question: 'chart it',
          sql: 'select 1',
        }),
        updateOne: jest.fn().mockResolvedValue({ id: 11 }),
      };
      service.wrenAIAdaptor = {
        generateChart: jest.fn().mockResolvedValue({ queryId: 'chart-1' }),
      };
      service.chartBackgroundTracker = {
        addTask: jest.fn(),
      };

      const result = await service.generateThreadResponseChartScoped(
        11,
        runtimeIdentity,
        { language: 'English' },
        'scope-1',
      );

      expect(service.wrenAIAdaptor.generateChart).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            columns: [{ name: 'value', type: 'number' }],
            data: [[1]],
          }),
          runtimeScopeId: 'scope-1',
          runtimeIdentity,
        }),
      );
      expect(service.chartBackgroundTracker.addTask).toHaveBeenCalledWith(
        result,
      );
    });

    it('applies deterministic chart adjustments locally without calling AI', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.assertResponseScope = jest.fn().mockResolvedValue(undefined);
      service.threadResponseRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 12,
          threadId: 9,
          question: 'adjust it',
          sql: 'select 1',
          chartDetail: {
            status: 'FINISHED',
            chartType: 'BAR',
            chartSchema: {
              mark: 'bar',
              encoding: {
                x: { field: 'category', type: 'nominal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        }),
        updateOne: jest.fn().mockResolvedValue({ id: 12, chartDetail: {} }),
      };
      service.wrenAIAdaptor = {
        adjustChart: jest.fn(),
      };

      const result = await service.adjustThreadResponseChartScoped(
        12,
        runtimeIdentity,
        { chartType: 'line' as any, xAxis: 'category', yAxis: 'value' },
        { language: 'English' },
      );

      expect(service.wrenAIAdaptor.adjustChart).not.toHaveBeenCalled();
      expect(service.threadResponseRepository.updateOne).toHaveBeenCalledWith(
        12,
        expect.objectContaining({
          chartDetail: expect.objectContaining({
            chartType: 'LINE',
            chartSchema: expect.objectContaining({
              mark: expect.objectContaining({ type: 'line' }),
            }),
          }),
        }),
      );
      expect(result).toEqual({ id: 12, chartDetail: {} });
    });
  });

  describe('initialize', () => {
    it('hydrates the breakdown tracker from repository-filtered unfinished responses', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.backgroundTrackerWorkspaceId = 'workspace-1';
      service.threadResponseRepository = {
        findUnfinishedBreakdownResponsesByWorkspaceId: jest
          .fn()
          .mockResolvedValue([
            { id: 11, breakdownDetail: { status: 'UNDERSTANDING' } },
            { id: 12, breakdownDetail: { status: 'GENERATING' } },
          ]),
        findUnfinishedBreakdownResponses: jest.fn(),
        findUnfinishedChartResponses: jest.fn().mockResolvedValue([]),
      };
      service.knowledgeBaseRepository = {
        findAll: jest.fn(),
      };
      service.breakdownBackgroundTracker = {
        addTask: jest.fn(),
      };
      service.chartBackgroundTracker = {
        addTask: jest.fn(),
      };
      service.chartAdjustmentBackgroundTracker = {
        addTask: jest.fn(),
      };

      await service.initialize();

      expect(
        service.threadResponseRepository
          .findUnfinishedBreakdownResponsesByWorkspaceId,
      ).toHaveBeenCalledTimes(1);
      expect(
        service.threadResponseRepository
          .findUnfinishedBreakdownResponsesByWorkspaceId,
      ).toHaveBeenCalledWith('workspace-1');
      expect(
        service.threadResponseRepository.findUnfinishedBreakdownResponses,
      ).not.toHaveBeenCalled();
      expect(
        service.threadResponseRepository.findUnfinishedChartResponses,
      ).toHaveBeenNthCalledWith(1, { adjustment: false });
      expect(
        service.threadResponseRepository.findUnfinishedChartResponses,
      ).toHaveBeenNthCalledWith(2, { adjustment: true });
      expect(
        service.breakdownBackgroundTracker.addTask,
      ).toHaveBeenNthCalledWith(1, {
        id: 11,
        breakdownDetail: { status: 'UNDERSTANDING' },
      });
      expect(
        service.breakdownBackgroundTracker.addTask,
      ).toHaveBeenNthCalledWith(2, {
        id: 12,
        breakdownDetail: { status: 'GENERATING' },
      });
    });

    it('hydrates unfinished breakdown responses across all workspaces when no explicit background workspace is configured', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.backgroundTrackerWorkspaceId = null;
      service.threadResponseRepository = {
        findUnfinishedBreakdownResponsesByWorkspaceId: jest.fn(),
        findUnfinishedBreakdownResponses: jest.fn().mockResolvedValue([
          { id: 21, breakdownDetail: { status: 'UNDERSTANDING' } },
          { id: 22, breakdownDetail: { status: 'GENERATING' } },
        ]),
        findUnfinishedChartResponses: jest.fn().mockResolvedValue([]),
      };
      service.knowledgeBaseRepository = {
        findAll: jest
          .fn()
          .mockResolvedValue([
            { workspaceId: 'workspace-1' },
            { workspaceId: 'workspace-2' },
          ]),
      };
      service.breakdownBackgroundTracker = {
        addTask: jest.fn(),
      };
      service.chartBackgroundTracker = {
        addTask: jest.fn(),
      };
      service.chartAdjustmentBackgroundTracker = {
        addTask: jest.fn(),
      };

      await service.initialize();

      expect(
        service.threadResponseRepository
          .findUnfinishedBreakdownResponsesByWorkspaceId,
      ).not.toHaveBeenCalled();
      expect(
        service.threadResponseRepository.findUnfinishedBreakdownResponses,
      ).toHaveBeenCalledTimes(1);
      expect(
        service.threadResponseRepository.findUnfinishedChartResponses,
      ).toHaveBeenNthCalledWith(1, { adjustment: false });
      expect(
        service.threadResponseRepository.findUnfinishedChartResponses,
      ).toHaveBeenNthCalledWith(2, { adjustment: true });
      expect(
        service.breakdownBackgroundTracker.addTask,
      ).toHaveBeenNthCalledWith(1, {
        id: 21,
        breakdownDetail: { status: 'UNDERSTANDING' },
      });
      expect(
        service.breakdownBackgroundTracker.addTask,
      ).toHaveBeenNthCalledWith(2, {
        id: 22,
        breakdownDetail: { status: 'GENERATING' },
      });
    });

    it('rehydrates unfinished chart jobs into the matching chart trackers', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.backgroundTrackerWorkspaceId = null;
      service.threadResponseRepository = {
        findUnfinishedBreakdownResponsesByWorkspaceId: jest.fn(),
        findUnfinishedBreakdownResponses: jest.fn().mockResolvedValue([]),
        findUnfinishedChartResponses: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 31, chartDetail: { adjustment: false } },
          ])
          .mockResolvedValueOnce([
            { id: 32, chartDetail: { adjustment: true } },
          ]),
      };
      service.knowledgeBaseRepository = {
        findAll: jest.fn().mockResolvedValue([]),
      };
      service.breakdownBackgroundTracker = {
        addTask: jest.fn(),
      };
      service.chartBackgroundTracker = {
        addTask: jest.fn(),
      };
      service.chartAdjustmentBackgroundTracker = {
        addTask: jest.fn(),
      };

      await service.initialize();

      expect(
        service.threadResponseRepository.findUnfinishedChartResponses,
      ).toHaveBeenNthCalledWith(1, { adjustment: false });
      expect(
        service.threadResponseRepository.findUnfinishedChartResponses,
      ).toHaveBeenNthCalledWith(2, { adjustment: true });
      expect(service.chartBackgroundTracker.addTask).toHaveBeenCalledWith({
        id: 31,
        chartDetail: { adjustment: false },
      });
      expect(
        service.chartAdjustmentBackgroundTracker.addTask,
      ).toHaveBeenCalledWith({
        id: 32,
        chartDetail: { adjustment: true },
      });
    });
  });

  describe('adjustment runtime scope forwarding', () => {
    const runtimeIdentity = {
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    };

    it('passes runtimeScopeId when adjusting thread response answers', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.assertResponseScope = jest.fn().mockResolvedValue(undefined);
      service.threadResponseRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 13,
          threadId: 9,
          question: 'adjust reasoning',
          sql: 'select 1',
        }),
      };
      service.adjustmentBackgroundTracker = {
        createAdjustmentTask: jest.fn().mockResolvedValue({
          createdThreadResponse: { id: 13 },
        }),
      };

      const result = await service.adjustThreadResponseAnswerScoped(
        13,
        runtimeIdentity,
        {
          runtimeIdentity,
          tables: ['orders'],
          sqlGenerationReasoning: 'need filter',
        },
        { language: 'English' },
        'scope-1',
      );

      expect(
        service.adjustmentBackgroundTracker.createAdjustmentTask,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeScopeId: 'scope-1',
          runtimeIdentity,
        }),
      );
      expect(result).toEqual({ id: 13 });
    });

    it('falls back to persisted runtime identity when runtimeScopeId is omitted for rerun adjustments', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadResponseRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 14,
          threadId: 9,
        }),
      };
      service.adjustmentBackgroundTracker = {
        rerunAdjustmentTask: jest.fn().mockResolvedValue({
          queryId: 'adjust-1',
        }),
      };

      const result = await service.rerunAdjustThreadResponseAnswer(
        14,
        runtimeIdentity,
        { language: 'English' },
      );

      expect(
        service.adjustmentBackgroundTracker.rerunAdjustmentTask,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          threadResponseId: 14,
          runtimeScopeId: 'deploy-1',
          runtimeIdentity,
        }),
      );
      expect(result).toEqual({ queryId: 'adjust-1' });
    });
  });
});
