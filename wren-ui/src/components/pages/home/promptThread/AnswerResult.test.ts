import {
  AskingTaskStatus,
  AskingTaskType,
  ThreadResponseAnswerStatus,
} from '@/types/home';
import {
  scheduleAutoGenerateAnswer,
  shouldAutoGenerateAnswer,
} from './answerGeneration';

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
});
