import { ThreadResponseRecommendQuestionBackgroundTracker } from '../recommend-question';
import { RecommendationQuestionStatus } from '@server/models/adaptor';
import { TelemetryEvent } from '../../telemetry/telemetry';

describe('recommend question background trackers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('thread response tracker emits finalized telemetry for response-scoped recommendations', async () => {
    const telemetry = { sendEvent: jest.fn() } as any;
    const tracker = new ThreadResponseRecommendQuestionBackgroundTracker({
      telemetry,
      wrenAIAdaptor: {
        getRecommendationQuestionsResult: jest.fn().mockResolvedValue({
          status: RecommendationQuestionStatus.FINISHED,
          response: {
            questions: [
              {
                question: '按部门查看平均薪资趋势',
                category: 'trend',
                interaction_mode: 'draft_to_composer',
                suggested_intent: 'ASK',
              },
            ],
          },
        }),
      } as any,
      threadResponseRepository: {
        findUnfinishedRecommendationResponses: jest.fn().mockResolvedValue([]),
        updateOne: jest.fn().mockResolvedValue({
          id: 31,
          sourceResponseId: 11,
          recommendationDetail: {
            queryId: 'rec-31',
            status: RecommendationQuestionStatus.FINISHED,
            sourceResponseId: 11,
            items: [
              {
                category: 'trend',
                interactionMode: 'draft_to_composer',
                label: '按部门查看平均薪资趋势',
                prompt: '按部门查看平均薪资趋势',
                suggestedIntent: 'ASK',
              },
            ],
          },
        }),
      } as any,
    });

    tracker.addTask({
      id: 31,
      sourceResponseId: 11,
      recommendationDetail: {
        queryId: 'rec-31',
        status: RecommendationQuestionStatus.GENERATING,
        sourceResponseId: 11,
        items: [],
      },
    } as any);

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(telemetry.sendEvent).toHaveBeenCalledWith(
      TelemetryEvent.HOME_RECOMMENDATION_GENERATED,
      expect.objectContaining({
        threadResponseId: 31,
        sourceResponseId: 11,
        status: RecommendationQuestionStatus.FINISHED,
      }),
    );

    tracker.stop();
  });
});
