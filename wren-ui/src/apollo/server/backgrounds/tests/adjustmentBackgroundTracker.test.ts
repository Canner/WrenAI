import { AskFeedbackStatus } from '@server/models/adaptor';
import { AdjustmentBackgroundTaskTracker } from '../adjustmentBackgroundTracker';

describe('AdjustmentBackgroundTaskTracker', () => {
  const createTracker = () => {
    const wrenAIAdaptor = {
      createAskFeedback: jest.fn(),
      getAskFeedbackResult: jest.fn(),
      cancelAskFeedback: jest.fn(),
    };
    const askingTaskRepository = {
      createOne: jest.fn(),
      updateOne: jest.fn(),
      findByQueryId: jest.fn(),
      findOneBy: jest.fn(),
    };
    const threadResponseRepository = {
      createOne: jest.fn(),
      updateOne: jest.fn(),
      findOneBy: jest.fn(),
    };
    const tracker = new AdjustmentBackgroundTaskTracker({
      telemetry: {
        sendEvent: jest.fn(),
      } as any,
      wrenAIAdaptor: wrenAIAdaptor as any,
      askingTaskRepository: askingTaskRepository as any,
      threadResponseRepository: threadResponseRepository as any,
      pollingInterval: 100000,
    });
    tracker.stopPolling();
    return {
      tracker,
      wrenAIAdaptor,
      askingTaskRepository,
      threadResponseRepository,
    };
  };

  it('persists runtime identity when creating an adjustment task', async () => {
    const {
      tracker,
      wrenAIAdaptor,
      askingTaskRepository,
      threadResponseRepository,
    } = createTracker();

    wrenAIAdaptor.createAskFeedback.mockResolvedValue({ queryId: 'adjust-1' });
    askingTaskRepository.createOne.mockResolvedValue({ id: 11 });
    threadResponseRepository.createOne.mockResolvedValue({ id: 22 });
    askingTaskRepository.updateOne.mockResolvedValue({});

    await tracker.createAdjustmentTask({
      threadId: 5,
      question: 'why changed',
      originalThreadResponseId: 3,
      tables: ['orders'],
      sqlGenerationReasoning: 'need filter',
      sql: 'select * from orders',
      runtimeScopeId: 'scope-1',
      configurations: { language: 'en' },
      runtimeIdentity: {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
    });

    expect(wrenAIAdaptor.createAskFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeScopeId: 'scope-1',
      }),
    );

    expect(askingTaskRepository.createOne).toHaveBeenCalledWith({
      queryId: 'adjust-1',
      question: 'why changed',
      threadId: 5,
      detail: {
        adjustment: true,
        status: AskFeedbackStatus.UNDERSTANDING,
        response: [],
        error: null,
      },
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });
  });

  it('keeps runtime identity when rerunning an adjustment task', async () => {
    const {
      tracker,
      wrenAIAdaptor,
      askingTaskRepository,
      threadResponseRepository,
    } = createTracker();

    threadResponseRepository.findOneBy
      .mockResolvedValueOnce({
        id: 22,
        threadId: 5,
        askingTaskId: 11,
        adjustment: {
          payload: {
            originalThreadResponseId: 3,
            retrievedTables: ['orders'],
            sqlGenerationReasoning: 'need filter',
          },
        },
      })
      .mockResolvedValueOnce({
        id: 3,
        question: 'why changed',
        sql: 'select * from orders',
      });
    wrenAIAdaptor.createAskFeedback.mockResolvedValue({ queryId: 'adjust-2' });
    askingTaskRepository.updateOne.mockResolvedValue({});

    await tracker.rerunAdjustmentTask({
      threadResponseId: 22,
      threadId: 5,
      runtimeScopeId: 'scope-1',
      configurations: { language: 'en' },
      runtimeIdentity: {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
    });

    expect(wrenAIAdaptor.createAskFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeScopeId: 'scope-1',
      }),
    );

    expect(askingTaskRepository.updateOne).toHaveBeenCalledWith(11, {
      queryId: 'adjust-2',
      detail: {
        adjustment: true,
        status: AskFeedbackStatus.UNDERSTANDING,
        response: [],
        error: null,
      },
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });
  });
});
