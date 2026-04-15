import { TextBasedAnswerStatus } from '@server/models/adaptor';
import { ThreadResponseAnswerStatus } from '@server/services/askingService';
import { TextBasedAnswerBackgroundTracker } from '../textBasedAnswerBackgroundTracker';

describe('TextBasedAnswerBackgroundTracker', () => {
  const flushBackgroundJobs = async (times = 8) => {
    for (let i = 0; i < times; i += 1) {
      await Promise.resolve();
    }
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses persisted response deploy hash instead of the latest deployment', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const wrenAIAdaptor = {
      createTextBasedAnswer: jest.fn().mockResolvedValue({ queryId: 'text-1' }),
      getTextBasedAnswerResult: jest.fn().mockResolvedValue({
        status: TextBasedAnswerStatus.SUCCEEDED,
        numRowsUsedInLLM: 10,
      }),
    };
    const threadResponseRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const threadRepository = {
      findOneBy: jest.fn(),
    };
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({
        id: 42,
        language: 'EN',
      }),
    };
    const deployService = {
      getDeploymentByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ projectId: 42, manifest: { models: [] } }),
    };
    const queryService = {
      preview: jest.fn().mockResolvedValue({ data: [] }),
    };

    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      threadResponseRepository: threadResponseRepository as any,
      threadRepository: threadRepository as any,
      projectService: projectService as any,
      deployService: deployService as any,
      queryService: queryService as any,
    });

    tracker.addTask({
      id: 7,
      threadId: 5,
      projectId: 42,
      deployHash: 'deploy-1',
      question: 'summarize it',
      sql: 'select * from orders',
      answerDetail: {
        status: ThreadResponseAnswerStatus.NOT_STARTED,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: 42,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: 'deploy-1',
      actorUserId: null,
    });
    expect(wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeScopeId: 'deploy-1',
        runtimeIdentity: {
          projectId: 42,
          workspaceId: null,
          knowledgeBaseId: null,
          kbSnapshotId: null,
          deployHash: 'deploy-1',
          actorUserId: null,
        },
      }),
    );
    expect(threadRepository.findOneBy).not.toHaveBeenCalled();
  });

  it('falls back to parent thread runtime identity when response uses legacy-null bridge fields', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const wrenAIAdaptor = {
      createTextBasedAnswer: jest.fn().mockResolvedValue({ queryId: 'text-2' }),
      getTextBasedAnswerResult: jest.fn().mockResolvedValue({
        status: TextBasedAnswerStatus.SUCCEEDED,
        numRowsUsedInLLM: 10,
      }),
    };
    const threadResponseRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const threadRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 5,
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-thread',
        actorUserId: 'user-1',
      }),
    };
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({
        id: 42,
        language: 'EN',
      }),
    };
    const deployService = {
      getDeploymentByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ projectId: 42, manifest: { models: [] } }),
    };
    const queryService = {
      preview: jest.fn().mockResolvedValue({ data: [] }),
    };

    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      threadResponseRepository: threadResponseRepository as any,
      threadRepository: threadRepository as any,
      projectService: projectService as any,
      deployService: deployService as any,
      queryService: queryService as any,
    });

    tracker.addTask({
      id: 8,
      threadId: 5,
      projectId: null,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      actorUserId: null,
      question: 'summarize it',
      sql: 'select * from orders',
      answerDetail: {
        status: ThreadResponseAnswerStatus.NOT_STARTED,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-thread',
      actorUserId: 'user-1',
    });
    expect(wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeScopeId: 'deploy-thread',
        runtimeIdentity: {
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-thread',
          actorUserId: 'user-1',
        },
      }),
    );
    expect(threadRepository.findOneBy).toHaveBeenCalledWith({ id: 5 });
  });

  it('prefers knowledge base language over bridged project language', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const wrenAIAdaptor = {
      createTextBasedAnswer: jest.fn().mockResolvedValue({ queryId: 'text-3' }),
      getTextBasedAnswerResult: jest.fn().mockResolvedValue({
        status: TextBasedAnswerStatus.SUCCEEDED,
        numRowsUsedInLLM: 10,
      }),
    };
    const threadResponseRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const threadRepository = {
      findOneBy: jest.fn(),
    };
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({
        id: 42,
        language: 'EN',
      }),
    };
    const deployService = {
      getDeploymentByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ projectId: 42, manifest: { models: [] } }),
    };
    const queryService = {
      preview: jest.fn().mockResolvedValue({ data: [] }),
    };
    const knowledgeBaseRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'kb-1',
        language: 'ZH_TW',
      }),
    };

    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      threadResponseRepository: threadResponseRepository as any,
      threadRepository: threadRepository as any,
      projectService: projectService as any,
      deployService: deployService as any,
      queryService: queryService as any,
      knowledgeBaseRepository: knowledgeBaseRepository as any,
    });

    tracker.addTask({
      id: 9,
      threadId: 5,
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
      question: 'summarize it',
      sql: 'select * from orders',
      answerDetail: {
        status: ThreadResponseAnswerStatus.NOT_STARTED,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(knowledgeBaseRepository.findOneBy).toHaveBeenCalledWith({
      id: 'kb-1',
    });
    expect(wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        configurations: {
          language: 'Traditional Chinese',
        },
      }),
    );
  });
});
