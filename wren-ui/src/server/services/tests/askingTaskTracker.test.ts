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
      projectId: null,
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
      projectId: null,
      workspaceId: 'workspace-9',
      knowledgeBaseId: 'kb-9',
      kbSnapshotId: 'snapshot-9',
      deployHash: 'deploy-9',
      actorUserId: 'user-9',
    });
  });

  it('reuses the same runtime identity payload when rerunning a cancelled task', async () => {
    const tracker = createTracker();
    const wrenAIAdaptor = (tracker as any).wrenAIAdaptor;
    const askingTaskRepository = (tracker as any).askingTaskRepository;
    wrenAIAdaptor.ask.mockResolvedValue({ queryId: 'query-rerun' });
    wrenAIAdaptor.getAskResult.mockResolvedValue({
      status: AskResultStatus.UNDERSTANDING,
      response: [],
    });

    await tracker.createAskingTask({
      query: 'rerun me',
      rerunFromCancelled: true,
      previousTaskId: 77,
      threadResponseId: 55,
      runtimeIdentity: {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
    } as any);

    expect(askingTaskRepository.updateOne).toHaveBeenCalledWith(77, {
      queryId: 'query-rerun',
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });

    expect(wrenAIAdaptor.ask.mock.calls[0][0].runtimeIdentity).toEqual({
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });
  });

  it('persists an understanding-state task immediately after creation', async () => {
    const tracker = createTracker();
    const wrenAIAdaptor = (tracker as any).wrenAIAdaptor;
    const askingTaskRepository = (tracker as any).askingTaskRepository;
    wrenAIAdaptor.ask.mockResolvedValue({ queryId: 'query-new' });
    askingTaskRepository.findByQueryId.mockResolvedValue(null);
    askingTaskRepository.createOne.mockResolvedValue({ id: 12 });

    await tracker.createAskingTask({
      query: '最近7天订单量趋势',
      deployId: 'deploy-1',
      runtimeIdentity: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
    } as any);

    expect(askingTaskRepository.createOne).toHaveBeenCalledWith({
      queryId: 'query-new',
      question: '最近7天订单量趋势',
      detail: {
        type: null,
        status: AskResultStatus.UNDERSTANDING,
        response: [],
        error: null,
      },
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });
  });

  it('normalizes canonical runtime identity before sending ask requests and caching tracked tasks', async () => {
    const tracker = createTracker();
    const wrenAIAdaptor = (tracker as any).wrenAIAdaptor;
    const askingTaskRepository = (tracker as any).askingTaskRepository;
    wrenAIAdaptor.ask.mockResolvedValue({ queryId: 'query-normalized' });
    askingTaskRepository.findByQueryId.mockResolvedValue(null);
    askingTaskRepository.createOne.mockResolvedValue({ id: 18 });

    await tracker.createAskingTask({
      query: '按部门统计在职员工数',
      deployId: 'deploy-1',
      runtimeIdentity: {
        projectId: 321,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
    } as any);

    expect(wrenAIAdaptor.ask.mock.calls[0][0].runtimeIdentity).toEqual({
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });

    expect((tracker as any).trackedTasks.get('query-normalized')).toEqual(
      expect.objectContaining({
        runtimeIdentity: {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
      }),
    );
  });

  it('reuses the same runtime identity payload when polling updates an existing task record', async () => {
    const tracker = createTracker();
    const askingTaskRepository = (tracker as any).askingTaskRepository;
    askingTaskRepository.findByQueryId.mockResolvedValue({ id: 88 });

    await (tracker as any).updateTaskInDatabase(
      { queryId: 'query-3' },
      {
        queryId: 'query-3',
        lastPolled: Date.now(),
        question: 'tracked',
        result: { status: AskResultStatus.FINISHED, response: [] },
        isFinalized: true,
        runtimeIdentity: {
          projectId: 7,
          workspaceId: 'workspace-7',
          knowledgeBaseId: 'kb-7',
          kbSnapshotId: 'snapshot-7',
          deployHash: 'deploy-7',
          actorUserId: 'user-7',
        },
      },
    );

    expect(askingTaskRepository.updateOne).toHaveBeenCalledWith(88, {
      detail: { status: AskResultStatus.FINISHED, response: [] },
      projectId: null,
      workspaceId: 'workspace-7',
      knowledgeBaseId: 'kb-7',
      kbSnapshotId: 'snapshot-7',
      deployHash: 'deploy-7',
      actorUserId: 'user-7',
    });
  });

  it('persists finalized text-to-sql results onto the bound thread response', async () => {
    const tracker = createTracker();
    const threadResponseRepository = ((
      tracker as any
    ).threadResponseRepository = {
      updateOne: jest.fn(),
    });

    await (tracker as any).updateThreadResponseWhenTaskFinalized({
      threadResponseId: 21,
      result: {
        status: AskResultStatus.FINISHED,
        type: 'TEXT_TO_SQL',
        response: [{ sql: 'SELECT 1' }],
      },
    });

    expect(threadResponseRepository.updateOne).toHaveBeenCalledWith(21, {
      sql: 'SELECT 1',
    });
  });

  it('persists GENERAL asking results to the database instead of leaving them in understanding state', async () => {
    const tracker = createTracker();
    const wrenAIAdaptor = (tracker as any).wrenAIAdaptor;
    const askingTaskRepository = (tracker as any).askingTaskRepository;

    wrenAIAdaptor.getAskResult.mockResolvedValue({
      status: AskResultStatus.FINISHED,
      type: 'GENERAL',
      response: [],
      error: null,
    });
    askingTaskRepository.findByQueryId.mockResolvedValue({ id: 91 });

    (tracker as any).trackedTasks.set('query-general', {
      queryId: 'query-general',
      taskId: 91,
      lastPolled: Date.now(),
      question: '这个知识库能回答什么？',
      result: {
        status: AskResultStatus.UNDERSTANDING,
        response: [],
        error: null,
      },
      isFinalized: false,
    });

    await (tracker as any).pollTasks();
    await Promise.resolve();
    await Promise.resolve();

    expect(askingTaskRepository.updateOne).toHaveBeenCalledWith(
      91,
      expect.objectContaining({
        detail: expect.objectContaining({
          status: AskResultStatus.FINISHED,
          type: 'GENERAL',
        }),
      }),
    );
  });

  it('normalizes canonical runtime identity when rehydrating unfinished tasks', async () => {
    const tracker = createTracker();

    tracker.rehydrateTrackedTask({
      id: 71,
      queryId: 'query-71',
      question: 'rehydrate me',
      detail: {
        status: AskResultStatus.UNDERSTANDING,
        response: [],
      } as any,
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect((tracker as any).trackedTasks.get('query-71')).toEqual(
      expect.objectContaining({
        runtimeIdentity: {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
      }),
    );
  });
});
