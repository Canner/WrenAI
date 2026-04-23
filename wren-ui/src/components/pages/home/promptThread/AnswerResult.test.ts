import {
  AskingTaskStatus,
  AskingTaskType,
  ThreadResponseAnswerStatus,
} from '@/types/home';
import {
  scheduleAutoGenerateAnswer,
  shouldAutoGenerateAnswer,
} from './answerGeneration';
import {
  hasSettledConversationAids,
  resolveConversationAidOwnerResponseId,
} from '@/features/home/thread/conversationAidVisibility';

describe('AnswerResult answer auto-generation guard', () => {
  it('becomes true when SQL arrives after the ask task already finished', () => {
    expect(
      shouldAutoGenerateAnswer({
        isBreakdownOnly: false,
        askingTask: {
          status: AskingTaskStatus.FINISHED,
          type: AskingTaskType.TEXT_TO_SQL,
        } as any,
        adjustmentTask: null,
        answerDetail: {},
        sql: 'select 1',
      }),
    ).toBe(true);
  });

  it('stays false while answer generation is already in progress', () => {
    expect(
      shouldAutoGenerateAnswer({
        isBreakdownOnly: false,
        askingTask: {
          status: AskingTaskStatus.FINISHED,
          type: AskingTaskType.TEXT_TO_SQL,
        } as any,
        adjustmentTask: null,
        answerDetail: {
          status: ThreadResponseAnswerStatus.NOT_STARTED,
        },
        sql: 'select 1',
      }),
    ).toBe(false);
  });

  it('stays false when SQL is still missing', () => {
    expect(
      shouldAutoGenerateAnswer({
        isBreakdownOnly: false,
        askingTask: {
          status: AskingTaskStatus.FINISHED,
          type: AskingTaskType.TEXT_TO_SQL,
        } as any,
        adjustmentTask: null,
        answerDetail: {},
        sql: null,
      }),
    ).toBe(false);
  });

  it('only marks a request as dispatched after the delayed auto-generation actually runs', () => {
    jest.useFakeTimers();

    const requestRef = { current: null as string | null };
    const onGenerate = jest.fn();
    const requestKey = '41:select 1';

    const cancelFirstAttempt = scheduleAutoGenerateAnswer({
      requestRef,
      requestKey,
      onGenerate,
      delayMs: 250,
    });

    cancelFirstAttempt();
    expect(requestRef.current).toBeNull();
    expect(onGenerate).not.toHaveBeenCalled();

    scheduleAutoGenerateAnswer({
      requestRef,
      requestKey,
      onGenerate,
      delayMs: 250,
    });

    jest.advanceTimersByTime(250);

    expect(requestRef.current).toBe(requestKey);
    expect(onGenerate).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('falls back to the latest settled response with aids when selected response is not eligible', () => {
    expect(
      resolveConversationAidOwnerResponseId({
        selectedResponseId: 22,
        responses: [
          {
            id: 11,
            question: '已完成问答',
            responseKind: 'ANSWER',
            resolvedIntent: {
              conversationAidPlan: {
                responseAids: [{ kind: 'TRIGGER_RECOMMEND_QUESTIONS' }],
              },
            },
            askingTask: {
              status: AskingTaskStatus.FINISHED,
            },
          },
          {
            id: 22,
            question: '推荐问题',
            responseKind: 'RECOMMENDATION_FOLLOWUP',
            resolvedIntent: {
              conversationAidPlan: null,
            },
          },
        ] as any,
      }),
    ).toBe(11);
  });

  it('prefers a selected historical response when it has settled aids', () => {
    expect(
      resolveConversationAidOwnerResponseId({
        selectedResponseId: 11,
        responses: [
          {
            id: 11,
            question: '历史回答',
            responseKind: 'ANSWER',
            resolvedIntent: {
              conversationAidPlan: {
                responseAids: [{ kind: 'TRIGGER_RECOMMEND_QUESTIONS' }],
              },
            },
            askingTask: {
              status: AskingTaskStatus.FINISHED,
            },
          },
          {
            id: 22,
            question: '当前回答',
            responseKind: 'ANSWER',
            resolvedIntent: {
              conversationAidPlan: {
                responseAids: [{ kind: 'TRIGGER_RECOMMEND_QUESTIONS' }],
              },
            },
            askingTask: {
              status: AskingTaskStatus.FINISHED,
            },
          },
        ] as any,
      }),
    ).toBe(11);
  });

  it('treats finished answer responses as settled for conversation aids', () => {
    expect(
      hasSettledConversationAids({
        id: 31,
        threadId: 7,
        question: '回答',
        responseKind: 'ANSWER',
        answerDetail: {
          status: ThreadResponseAnswerStatus.FINISHED,
        },
      } as any),
    ).toBe(true);
  });
});
