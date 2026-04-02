import { AskingTaskTracker } from '../askingTaskTracker';
import { AskResultStatus } from '@server/models/adaptor';

describe('AskingTaskTracker', () => {
  const createTracker = () => {
    const tracker = new AskingTaskTracker({
      wrenAIAdaptor: {
        ask: jest.fn(),
        getAskResult: jest.fn(),
        cancelAsk: jest.fn(),
      } as any,
      askingTaskRepository: {
        findByQueryId: jest.fn(),
        findOneBy: jest.fn(),
        createOne: jest.fn(),
        updateOne: jest.fn(),
      } as any,
      threadResponseRepository: {} as any,
      viewRepository: {} as any,
      pollingInterval: 100000,
    });
    tracker.stopPolling();
    return tracker;
  };

  it('persists runtime identity when creating a new asking task record', async () => {
    const tracker = createTracker();
    const askingTaskRepository = (tracker as any).askingTaskRepository;
    askingTaskRepository.findByQueryId.mockResolvedValue(null);
    askingTaskRepository.createOne.mockResolvedValue({ id: 9 });

    await (tracker as any).updateTaskInDatabase(
      { queryId: 'query-1' },
      {
        queryId: 'query-1',
        lastPolled: Date.now(),
        question: 'hello',
        result: { status: AskResultStatus.FINISHED, response: [] },
        isFinalized: true,
        runtimeIdentity: {
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
      },
    );

    expect(askingTaskRepository.createOne).toHaveBeenCalledWith({
      queryId: 'query-1',
      question: 'hello',
      detail: { status: AskResultStatus.FINISHED, response: [] },
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });
  });

  it('keeps runtime identity updated on existing asking task records', async () => {
    const tracker = createTracker();
    const askingTaskRepository = (tracker as any).askingTaskRepository;
    askingTaskRepository.findByQueryId.mockResolvedValue({ id: 11 });

    await (tracker as any).updateTaskInDatabase(
      { queryId: 'query-2' },
      {
        queryId: 'query-2',
        lastPolled: Date.now(),
        question: 'world',
        result: { status: AskResultStatus.FAILED, response: [] },
        isFinalized: true,
        runtimeIdentity: {
          projectId: 99,
          workspaceId: 'workspace-9',
          knowledgeBaseId: 'kb-9',
          kbSnapshotId: 'snapshot-9',
          deployHash: 'deploy-9',
          actorUserId: 'user-9',
        },
      },
    );

    expect(askingTaskRepository.updateOne).toHaveBeenCalledWith(11, {
      detail: { status: AskResultStatus.FAILED, response: [] },
      projectId: 99,
      workspaceId: 'workspace-9',
      knowledgeBaseId: 'kb-9',
      kbSnapshotId: 'snapshot-9',
      deployHash: 'deploy-9',
      actorUserId: 'user-9',
    });
  });
});
