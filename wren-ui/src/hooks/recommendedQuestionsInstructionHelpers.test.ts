import {
  buildEmptyRecommendedQuestionsTask,
  createRecommendationPollingLoader,
  getGroupedQuestions,
  resolveRecommendedQuestionsSettlement,
  shouldContinueRecommendationPolling,
} from './recommendedQuestionsInstructionHelpers';
import { RecommendedQuestionsTaskStatus } from '@/types/home';

describe('recommendedQuestionsInstructionHelpers', () => {
  it('builds an empty finished recommendation task for non-executable scopes', () => {
    expect(buildEmptyRecommendedQuestionsTask()).toEqual({
      status: RecommendedQuestionsTaskStatus.FINISHED,
      questions: [],
    });
  });

  it('groups recommendation questions by category frequency', () => {
    expect(
      getGroupedQuestions([
        { category: '趋势', question: '问题 1', sql: 'select 1' },
        { category: '构成', question: '问题 2', sql: 'select 2' },
        { category: '趋势', question: '问题 3', sql: 'select 3' },
      ]),
    ).toEqual([
      { category: '趋势', question: '问题 1', sql: 'select 1' },
      { category: '趋势', question: '问题 3', sql: 'select 3' },
      { category: '构成', question: '问题 2', sql: 'select 2' },
    ]);
  });

  it('continues polling only while recommendation generation is unfinished', () => {
    expect(
      shouldContinueRecommendationPolling({
        status: RecommendedQuestionsTaskStatus.GENERATING,
        questions: [],
      }),
    ).toBe(true);

    expect(
      shouldContinueRecommendationPolling({
        status: RecommendedQuestionsTaskStatus.NOT_STARTED,
        questions: [],
      }),
    ).toBe(false);

    expect(
      shouldContinueRecommendationPolling({
        status: RecommendedQuestionsTaskStatus.FINISHED,
        questions: [],
      }),
    ).toBe(false);
  });

  it('reuses the prefetched initial task before falling back to live polling reads', async () => {
    const loadTask = jest
      .fn()
      .mockResolvedValue(buildEmptyRecommendedQuestionsTask());
    const loader = createRecommendationPollingLoader(
      {
        status: RecommendedQuestionsTaskStatus.GENERATING,
        questions: [],
      },
      loadTask,
    );

    await expect(loader()).resolves.toEqual({
      status: RecommendedQuestionsTaskStatus.GENERATING,
      questions: [],
    });
    await expect(loader()).resolves.toEqual({
      status: RecommendedQuestionsTaskStatus.FINISHED,
      questions: [],
    });
    expect(loadTask).toHaveBeenCalledTimes(1);
  });

  it('resolves recommendation settlement for successful and failed regenerate outcomes', () => {
    expect(
      resolveRecommendedQuestionsSettlement({
        task: {
          status: RecommendedQuestionsTaskStatus.FINISHED,
          questions: [
            { category: '趋势', question: '问题 1', sql: 'select 1' },
          ],
        },
        isRegenerate: false,
        showRecommendedQuestionsPromptMode: false,
      }),
    ).toEqual({
      nextRecommendedQuestions: [
        { category: '趋势', question: '问题 1', sql: 'select 1' },
      ],
      nextShowRetry: false,
      nextShowRecommendedQuestionsPromptMode: true,
      nextIsRegenerate: true,
      shouldReportRegenerateFailure: false,
    });

    expect(
      resolveRecommendedQuestionsSettlement({
        task: {
          status: RecommendedQuestionsTaskStatus.FAILED,
          questions: [],
        },
        isRegenerate: true,
        showRecommendedQuestionsPromptMode: true,
      }),
    ).toEqual({
      nextRecommendedQuestions: null,
      nextShowRetry: true,
      nextShowRecommendedQuestionsPromptMode: true,
      nextIsRegenerate: true,
      shouldReportRegenerateFailure: true,
    });
  });
});
