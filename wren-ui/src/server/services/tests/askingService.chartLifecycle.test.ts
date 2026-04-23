import { AskingService } from '../askingService';

describe('AskingService', () => {
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
          columns: [
            { name: 'category', type: 'string' },
            { name: 'value', type: 'number' },
          ],
          data: [
            ['A', 1],
            ['B', 2],
          ],
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
            columns: [
              { name: 'category', type: 'string' },
              { name: 'value', type: 'number' },
            ],
            data: [
              ['A', 1],
              ['B', 2],
            ],
          }),
          runtimeScopeId: 'scope-1',
          runtimeIdentity,
        }),
      );
      expect(service.chartBackgroundTracker.addTask).toHaveBeenCalledWith(
        result,
      );
      expect(service.threadResponseRepository.updateOne).toHaveBeenCalledWith(
        11,
        expect.objectContaining({
          chartDetail: expect.objectContaining({
            diagnostics: expect.objectContaining({
              previewColumnCount: 2,
              previewRowCount: 2,
              previewColumns: [
                { name: 'category', type: 'string' },
                { name: 'value', type: 'number' },
              ],
            }),
            thinking: expect.objectContaining({
              currentStepKey: 'chart.chart_type_selected',
              steps: expect.arrayContaining([
                expect.objectContaining({
                  key: 'chart.sql_pairs_retrieved',
                  status: 'finished',
                  messageParams: expect.objectContaining({
                    count: 0,
                  }),
                }),
                expect.objectContaining({
                  key: 'chart.sql_instructions_retrieved',
                  status: 'finished',
                  messageParams: expect.objectContaining({
                    count: 0,
                  }),
                }),
                expect.objectContaining({
                  key: 'chart.preview_data_fetched',
                  status: 'finished',
                }),
                expect.objectContaining({
                  key: 'chart.chart_instructions_retrieved',
                  status: 'finished',
                  messageParams: expect.objectContaining({
                    count: 0,
                  }),
                }),
                expect.objectContaining({
                  key: 'chart.chart_type_selected',
                  status: 'running',
                }),
              ]),
            }),
          }),
        }),
      );
    });

    it('carries source ask retrieval context into chart follow-up thinking', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.assertResponseScope = jest.fn().mockResolvedValue(undefined);
      service.getExecutionResources = jest.fn().mockResolvedValue({
        project: { id: 42 },
        manifest: { models: [] },
      });
      service.queryService = {
        preview: jest.fn().mockResolvedValue({
          columns: [
            { name: 'category', type: 'string' },
            { name: 'value', type: 'number' },
          ],
          data: [
            ['A', 1],
            ['B', 2],
          ],
        }),
      };
      service.threadResponseRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 21,
          threadId: 9,
          question: '生成一张图表给我',
          responseKind: 'CHART_FOLLOWUP',
          sourceResponseId: 11,
          sql: 'select 1',
        }),
        updateOne: jest.fn().mockResolvedValue({ id: 21 }),
      };
      service.getResponse = jest.fn().mockResolvedValue({
        id: 11,
        threadId: 9,
        question: '各岗位平均薪资分别是多少？',
        sql: 'select 1',
        askingTaskId: 77,
      });
      service.getAskingTaskById = jest.fn().mockResolvedValue({
        thinking: {
          steps: [
            {
              key: 'ask.sql_pairs_retrieved',
              messageKey: 'ask.sql_pairs_retrieved',
              messageParams: { count: 2 },
              status: 'finished',
            },
            {
              key: 'ask.sql_instructions_retrieved',
              messageKey: 'ask.sql_instructions_retrieved',
              messageParams: { count: 1 },
              status: 'finished',
            },
          ],
        },
      });
      service.wrenAIAdaptor = {
        generateChart: jest.fn().mockResolvedValue({ queryId: 'chart-2' }),
      };
      service.chartBackgroundTracker = {
        addTask: jest.fn(),
      };

      await service.generateThreadResponseChartScoped(
        21,
        runtimeIdentity,
        { language: 'English' },
        'scope-1',
      );

      expect(service.threadResponseRepository.updateOne).toHaveBeenCalledWith(
        21,
        expect.objectContaining({
          chartDetail: expect.objectContaining({
            thinking: expect.objectContaining({
              steps: expect.arrayContaining([
                expect.objectContaining({
                  key: 'chart.sql_pairs_retrieved',
                  messageParams: expect.objectContaining({
                    count: 2,
                  }),
                }),
                expect.objectContaining({
                  key: 'chart.sql_instructions_retrieved',
                  messageParams: expect.objectContaining({
                    count: 1,
                  }),
                }),
              ]),
            }),
          }),
        }),
      );
    });

    it('marks chart generation as upstream-data failure when preview fetch fails', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.assertResponseScope = jest.fn().mockResolvedValue(undefined);
      service.getExecutionResources = jest.fn().mockResolvedValue({
        project: { id: 42 },
        manifest: { models: [] },
      });
      service.queryService = {
        preview: jest.fn().mockRejectedValue(new Error('socket hang up')),
      };
      service.threadResponseRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 13,
          threadId: 9,
          question: 'chart it',
          sql: 'select 1',
        }),
        updateOne: jest.fn().mockResolvedValue({ id: 13 }),
      };
      service.wrenAIAdaptor = {
        generateChart: jest.fn(),
      };
      service.chartBackgroundTracker = {
        addTask: jest.fn(),
      };

      await service.generateThreadResponseChartScoped(
        13,
        runtimeIdentity,
        { language: 'English' },
        'scope-1',
      );

      expect(service.wrenAIAdaptor.generateChart).not.toHaveBeenCalled();
      expect(service.chartBackgroundTracker.addTask).not.toHaveBeenCalled();
      expect(service.threadResponseRepository.updateOne).toHaveBeenCalledWith(
        13,
        expect.objectContaining({
          chartDetail: expect.objectContaining({
            status: 'FAILED',
            chartability: null,
            diagnostics: expect.objectContaining({
              lastErrorCode: 'UPSTREAM_DATA_ERROR',
              lastErrorMessage: 'socket hang up',
            }),
            error: expect.objectContaining({
              extensions: expect.objectContaining({
                code: 'UPSTREAM_DATA_ERROR',
              }),
            }),
            thinking: expect.objectContaining({
              currentStepKey: 'chart.preview_data_fetched',
              steps: expect.arrayContaining([
                expect.objectContaining({
                  key: 'chart.sql_pairs_retrieved',
                  status: 'finished',
                }),
                expect.objectContaining({
                  key: 'chart.preview_data_fetched',
                  status: 'failed',
                }),
                expect.objectContaining({
                  key: 'chart.chart_type_selected',
                  status: 'skipped',
                }),
              ]),
            }),
          }),
        }),
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
      service.askingTaskRepository = {
        findUnfinishedTasks: jest.fn().mockResolvedValue([]),
      };
      service.askingTaskTracker = {
        rehydrateTrackedTask: jest.fn(),
      };
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
        service.askingTaskRepository.findUnfinishedTasks,
      ).toHaveBeenCalled();
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
      service.askingTaskRepository = {
        findUnfinishedTasks: jest.fn().mockResolvedValue([]),
      };
      service.askingTaskTracker = {
        rehydrateTrackedTask: jest.fn(),
      };
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
        service.askingTaskRepository.findUnfinishedTasks,
      ).toHaveBeenCalled();
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
      service.askingTaskRepository = {
        findUnfinishedTasks: jest.fn().mockResolvedValue([]),
      };
      service.askingTaskTracker = {
        rehydrateTrackedTask: jest.fn(),
      };
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

    it('rehydrates unfinished asking tasks into the asking task tracker', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.backgroundTrackerWorkspaceId = null;
      service.askingTaskRepository = {
        findUnfinishedTasks: jest.fn().mockResolvedValue([
          {
            id: 88,
            queryId: 'ask-88',
            question: '各岗位的平均薪资分别是多少？',
            detail: { status: 'UNDERSTANDING', response: [], error: null },
            threadResponseId: 53,
            workspaceId: 'ws-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snap-1',
            deployHash: 'deploy-1',
            actorUserId: 'user-1',
          },
        ]),
      };
      service.askingTaskTracker = {
        rehydrateTrackedTask: jest.fn(),
      };
      service.threadResponseRepository = {
        findUnfinishedBreakdownResponsesByWorkspaceId: jest.fn(),
        findUnfinishedBreakdownResponses: jest.fn().mockResolvedValue([]),
        findUnfinishedAnswerResponses: jest.fn().mockResolvedValue([]),
        findUnfinishedChartResponses: jest.fn().mockResolvedValue([]),
      };
      service.knowledgeBaseRepository = {
        findAll: jest.fn().mockResolvedValue([]),
      };
      service.breakdownBackgroundTracker = {
        addTask: jest.fn(),
      };
      service.textBasedAnswerBackgroundTracker = {
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
        service.askingTaskRepository.findUnfinishedTasks,
      ).toHaveBeenCalled();
      expect(
        service.askingTaskTracker.rehydrateTrackedTask,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 88,
          queryId: 'ask-88',
          threadResponseId: 53,
        }),
      );
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
