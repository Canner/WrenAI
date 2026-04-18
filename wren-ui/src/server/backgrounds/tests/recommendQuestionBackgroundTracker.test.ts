import {
  ProjectRecommendQuestionBackgroundTracker,
  ThreadRecommendQuestionBackgroundTracker,
} from '../recommend-question';
import { RecommendationQuestionStatus } from '@server/models/adaptor';

describe('recommend question background trackers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('project tracker initialize restores only GENERATING records via findAllBy', async () => {
    const projectRepository = {
      findAll: jest.fn(),
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 1,
          queryId: 'q-1',
          questionsStatus: RecommendationQuestionStatus.GENERATING,
          questions: [],
          type: 'postgres',
        },
      ]),
      updateOne: jest.fn(),
    } as any;

    const tracker = new ProjectRecommendQuestionBackgroundTracker({
      telemetry: { sendEvent: jest.fn() } as any,
      wrenAIAdaptor: {
        getRecommendationQuestionsResult: jest.fn(),
      } as any,
      projectRepository,
    });

    await tracker.initialize();

    expect(projectRepository.findAllBy).toHaveBeenCalledWith({
      questionsStatus: RecommendationQuestionStatus.GENERATING,
    });
    expect(projectRepository.findAll).not.toHaveBeenCalled();
    expect(Object.keys(tracker.getTasks())).toEqual(['1']);

    tracker.stop();
  });

  it('thread tracker initialize restores only unfinished GENERATING threads with queryId', async () => {
    const threadRepository = {
      findAll: jest.fn(),
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 2,
          queryId: 'q-2',
          questionsStatus: RecommendationQuestionStatus.GENERATING,
          questions: [],
        },
        {
          id: 3,
          queryId: null,
          questionsStatus: RecommendationQuestionStatus.GENERATING,
          questions: [],
        },
      ]),
      updateOne: jest.fn(),
    } as any;

    const tracker = new ThreadRecommendQuestionBackgroundTracker({
      telemetry: { sendEvent: jest.fn() } as any,
      wrenAIAdaptor: {
        getRecommendationQuestionsResult: jest.fn(),
      } as any,
      threadRepository,
    });

    await tracker.initialize();

    expect(threadRepository.findAllBy).toHaveBeenCalledWith({
      questionsStatus: RecommendationQuestionStatus.GENERATING,
    });
    expect(threadRepository.findAll).not.toHaveBeenCalled();
    expect(Object.keys(tracker.getTasks())).toEqual(['2']);

    tracker.stop();
  });

  it('project tracker clears running job state when queryId is missing', async () => {
    const projectRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
      updateOne: jest.fn(),
    } as any;

    const tracker = new ProjectRecommendQuestionBackgroundTracker({
      telemetry: { sendEvent: jest.fn() } as any,
      wrenAIAdaptor: {
        getRecommendationQuestionsResult: jest.fn(),
      } as any,
      projectRepository,
    });

    const project = {
      id: 11,
      queryId: null,
      questionsStatus: RecommendationQuestionStatus.GENERATING,
      questions: [],
      type: 'postgres',
    } as any;

    tracker.addTask(project);
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(tracker.getTasks()).toEqual({});
    expect((tracker as any).runningJobs.size).toBe(0);

    tracker.stop();
  });

  it('thread tracker clears running job state after adaptor failure so next poll can retry', async () => {
    const adaptor = {
      getRecommendationQuestionsResult: jest
        .fn()
        .mockRejectedValueOnce(new Error('temporary upstream failure'))
        .mockResolvedValueOnce({
          status: RecommendationQuestionStatus.FINISHED,
          response: { questions: ['q1'] },
        }),
    } as any;
    const threadRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
      updateOne: jest.fn(),
    } as any;

    const tracker = new ThreadRecommendQuestionBackgroundTracker({
      telemetry: { sendEvent: jest.fn() } as any,
      wrenAIAdaptor: adaptor,
      threadRepository,
    });

    const thread = {
      id: 22,
      queryId: 'query-22',
      questionsStatus: RecommendationQuestionStatus.GENERATING,
      questions: [],
    } as any;

    tracker.addTask(thread);
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect((tracker as any).runningJobs.size).toBe(0);

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(adaptor.getRecommendationQuestionsResult).toHaveBeenCalledTimes(2);
    expect(threadRepository.updateOne).toHaveBeenCalledWith(22, {
      questionsStatus: RecommendationQuestionStatus.FINISHED.toUpperCase(),
      questions: ['q1'],
      questionsError: undefined,
    });
    expect(tracker.getTasks()).toEqual({});

    tracker.stop();
  });
});
