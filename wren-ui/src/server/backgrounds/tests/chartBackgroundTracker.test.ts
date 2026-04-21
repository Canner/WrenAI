import { ChartStatus } from '@server/models/adaptor';
import {
  ChartAdjustmentBackgroundTracker,
  ChartBackgroundTracker,
} from '../chart';

const flushBackgroundJobs = async (times = 6) => {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
};

describe('ChartBackgroundTracker', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('clears running jobs after polling failures and schedules retry metadata', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    jest.spyOn(global, 'setInterval').mockImplementation(((
      handler: TimerHandler,
    ) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const threadResponseRepository = {
      updateOneByIdWithRuntimeScope: jest.fn().mockResolvedValue({
        id: 5,
        question: 'show chart',
        projectId: 42,
        chartDetail: {
          queryId: 'chart-1',
          status: ChartStatus.FETCHING,
          retryCount: 1,
          nextRetryAt: '2099-01-01T00:00:00.000Z',
        },
      }),
    };
    const tracker = new ChartBackgroundTracker({
      telemetry: { sendEvent: jest.fn() } as any,
      wrenAIAdaptor: {
        getChartResult: jest.fn().mockRejectedValue(new Error('boom')),
      } as any,
      threadResponseRepository: threadResponseRepository as any,
    });

    tracker.addTask({
      id: 5,
      question: 'show chart',
      projectId: 42,
      chartDetail: {
        queryId: 'chart-1',
        status: ChartStatus.FETCHING,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(
      threadResponseRepository.updateOneByIdWithRuntimeScope,
    ).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ projectId: 42 }),
      expect.objectContaining({
        chartDetail: expect.objectContaining({
          diagnostics: expect.objectContaining({
            lastErrorCode: null,
            lastErrorMessage: 'boom',
          }),
          retryCount: 1,
          nextRetryAt: expect.any(String),
          lastError: 'boom',
        }),
      }),
    );
    expect((tracker as any).runningJobs.size).toBe(0);
  });

  it('skips polling when another worker holds the lease', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    jest.spyOn(global, 'setInterval').mockImplementation(((
      handler: TimerHandler,
    ) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const getChartResult = jest.fn();
    const tracker = new ChartBackgroundTracker({
      telemetry: { sendEvent: jest.fn() } as any,
      wrenAIAdaptor: {
        getChartResult,
      } as any,
      threadResponseRepository: {
        claimChartPollingLease: jest.fn().mockResolvedValue(null),
      } as any,
    });

    tracker.addTask({
      id: 7,
      question: 'leased chart',
      projectId: 42,
      chartDetail: {
        queryId: 'chart-7',
        status: ChartStatus.FETCHING,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(getChartResult).not.toHaveBeenCalled();
    expect((tracker as any).runningJobs.size).toBe(0);
  });

  it('canonicalizes finished chart results and removes finalized jobs', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    jest.spyOn(global, 'setInterval').mockImplementation(((
      handler: TimerHandler,
    ) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const updateOneByIdWithRuntimeScope = jest.fn().mockResolvedValue({
      id: 8,
      question: 'sales by month',
      projectId: 42,
      chartDetail: {
        queryId: 'chart-8',
        status: ChartStatus.FINISHED,
        chartType: 'LINE',
        chartSchema: { mark: { type: 'line' } },
      },
    });
    const telemetry = { sendEvent: jest.fn() };
    const tracker = new ChartBackgroundTracker({
      telemetry: telemetry as any,
      wrenAIAdaptor: {
        getChartResult: jest.fn().mockResolvedValue({
          status: ChartStatus.FINISHED,
          response: {
            reasoning: 'trend',
            chartType: 'line',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'month', type: 'temporal' },
                y: { field: 'sales', type: 'quantitative' },
              },
            },
          },
        }),
      } as any,
      threadResponseRepository: {
        updateOneByIdWithRuntimeScope,
      } as any,
    });

    tracker.addTask({
      id: 8,
      question: 'sales by month',
      projectId: 42,
      chartDetail: {
        queryId: 'chart-8',
        status: ChartStatus.FETCHING,
        diagnostics: {
          previewColumnCount: 2,
          previewRowCount: 30,
        },
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(updateOneByIdWithRuntimeScope).toHaveBeenCalledWith(
      8,
      expect.objectContaining({ projectId: 42 }),
      expect.objectContaining({
        chartDetail: expect.objectContaining({
          diagnostics: expect.objectContaining({
            lastErrorCode: null,
            lastErrorMessage: null,
            finalizedAt: expect.any(String),
            previewColumnCount: 2,
            previewRowCount: 30,
          }),
          chartType: 'LINE',
          rawChartSchema: expect.objectContaining({ mark: 'line' }),
          chartSchema: expect.objectContaining({
            mark: expect.objectContaining({ type: 'line' }),
          }),
          canonicalizationVersion: 'chart-canonical-v1',
        }),
      }),
    );
    expect(telemetry.sendEvent).toHaveBeenCalled();
    expect((tracker as any).getTasks()).toEqual({});
  });
});

describe('ChartAdjustmentBackgroundTracker', () => {
  it('marks recovered adjustment jobs with adjustment metadata', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    jest.spyOn(global, 'setInterval').mockImplementation(((
      handler: TimerHandler,
    ) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const updateOneByIdWithRuntimeScope = jest.fn().mockResolvedValue({
      id: 10,
      question: 'adjust chart',
      projectId: 42,
      chartDetail: {
        queryId: 'chart-10',
        status: ChartStatus.GENERATING,
      },
    });
    const tracker = new ChartAdjustmentBackgroundTracker({
      telemetry: { sendEvent: jest.fn() } as any,
      wrenAIAdaptor: {
        getChartAdjustmentResult: jest.fn().mockResolvedValue({
          status: ChartStatus.GENERATING,
          response: {
            reasoning: 'adjust',
            chartType: 'bar',
            chartSchema: {
              mark: 'bar',
              encoding: {
                x: { field: 'category', type: 'nominal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        }),
      } as any,
      threadResponseRepository: {
        updateOneByIdWithRuntimeScope,
      } as any,
    });

    tracker.addTask({
      id: 10,
      question: 'adjust chart',
      projectId: 42,
      chartDetail: {
        queryId: 'chart-10',
        status: ChartStatus.FETCHING,
        adjustment: true,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(updateOneByIdWithRuntimeScope).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ projectId: 42 }),
      expect.objectContaining({
        chartDetail: expect.objectContaining({
          adjustment: true,
        }),
      }),
    );
  });
});
