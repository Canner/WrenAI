import {
  AskingTaskTracker,
  TrackedAskingResult,
} from '../askingTaskTracker';
import {
  AskResultStatus,
  AskResultType,
} from '@server/models/adaptor';
import * as Errors from '@server/utils/error';

describe('AskingTaskTracker', () => {
  const createTracker = ({
    taskRecords = [],
    memoryRetentionTime = 1000,
  }: {
    taskRecords?: any[];
    memoryRetentionTime?: number;
  }) => {
    const askingTaskRepository = {
      findAll: jest.fn().mockResolvedValue(taskRecords),
      findByQueryId: jest.fn(),
      findOneBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };
    const wrenAIAdaptor = {
      getAskResult: jest.fn(),
      ask: jest.fn(),
      cancelAsk: jest.fn(),
    };
    const tracker = new AskingTaskTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      askingTaskRepository: askingTaskRepository as any,
      threadResponseRepository: { updateOne: jest.fn() } as any,
      viewRepository: { findOneBy: jest.fn() } as any,
      pollingInterval: 1000,
      memoryRetentionTime,
    });
    tracker.stopPolling();

    return {
      tracker,
      askingTaskRepository,
      wrenAIAdaptor,
    };
  };

  test('finalizes stale unfinished tasks during initialization without polling AI service', async () => {
    const oldDate = new Date(Date.now() - 60_000);
    const staleTask = {
      id: 7,
      queryId: 'expired-query-id',
      question: 'expired question',
      detail: {
        type: AskResultType.TEXT_TO_SQL,
        status: AskResultStatus.GENERATING,
        response: null,
        error: null,
      },
      createdAt: oldDate,
      updatedAt: oldDate,
    };
    const { tracker, askingTaskRepository, wrenAIAdaptor } = createTracker({
      taskRecords: [staleTask],
      memoryRetentionTime: 1000,
    });

    await tracker.initialize();

    expect(wrenAIAdaptor.getAskResult).not.toHaveBeenCalled();
    expect(askingTaskRepository.updateOne).toHaveBeenCalledWith(7, {
      detail: {
        type: AskResultType.TEXT_TO_SQL,
        status: AskResultStatus.FAILED,
        response: null,
        error: {
          code: Errors.GeneralErrorCodes.POLLING_TIMEOUT,
          message:
            'The previous asking task expired after the service restarted. Please ask again.',
        },
      },
    });
  });

  test('restores recent unfinished tasks so active AI service requests can continue', async () => {
    const recentDate = new Date();
    const recentTask = {
      id: 8,
      queryId: 'recent-query-id',
      question: 'recent question',
      detail: {
        type: AskResultType.TEXT_TO_SQL,
        status: AskResultStatus.GENERATING,
        response: null,
        error: null,
      },
      createdAt: recentDate,
      updatedAt: recentDate,
    };
    const { tracker, askingTaskRepository } = createTracker({
      taskRecords: [recentTask],
      memoryRetentionTime: 60_000,
    });

    await tracker.initialize();
    const result = (await tracker.getAskingResult(
      recentTask.queryId,
    )) as TrackedAskingResult;

    expect(askingTaskRepository.updateOne).not.toHaveBeenCalled();
    expect(result.queryId).toBe(recentTask.queryId);
    expect(result.status).toBe(AskResultStatus.GENERATING);
  });
});
