import { TextBasedAnswerStatus } from '@server/models/adaptor';
import { ThreadResponseAnswerStatus } from '@server/services/askingService';
import { TextBasedAnswerBackgroundTracker } from '../textBasedAnswerBackgroundTracker';

describe('TextBasedAnswerBackgroundTracker', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses persisted response deploy hash instead of the latest deployment', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    jest
      .spyOn(global, 'setInterval')
      .mockImplementation(((handler: TimerHandler) => {
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
      getDeployment: jest.fn().mockResolvedValue({ manifest: { models: [] } }),
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
    await Promise.resolve();
    await Promise.resolve();

    expect(deployService.getDeployment).toHaveBeenCalledWith(42, 'deploy-1');
    expect(threadRepository.findOneBy).not.toHaveBeenCalled();
  });
});
