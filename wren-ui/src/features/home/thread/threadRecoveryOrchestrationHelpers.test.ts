import {
  settleFinishedThreadResponsePolling,
  startThreadResponsePollingIfNeeded,
  syncThreadRecommendationPollingState,
} from './threadRecoveryPollingHelpers';
import { createThreadRecoveryCleanup } from './threadRecoveryCleanupHelpers';
import { runThreadRecoveryPlan } from './threadRecoveryPlanHelpers';
import { syncThreadQuestionStore } from './threadRecoveryQuestionStoreHelpers';

describe('thread recovery helper lanes', () => {
  const createAskPrompt = () => ({
    data: null,
    loading: false,
    onFetching: jest.fn(async () => undefined),
    onStopPolling: jest.fn(),
    onStopRecommend: jest.fn(),
    onStopStreaming: jest.fn(),
    onStoreThreadQuestions: jest.fn(),
  });

  it('runs the resume asking-task recovery plan', () => {
    const askPrompt = createAskPrompt();
    const pollingAskingTaskIdRef = { current: null as string | null };
    const pollingResponseIdRef = { current: 12 as number | null };
    const threadResponseRequestInFlightRef = { current: 12 as number | null };
    const startThreadResponsePolling = jest.fn();
    const stopThreadResponsePolling = jest.fn();

    runThreadRecoveryPlan({
      askPrompt,
      pollingAskingTaskIdRef,
      pollingResponseIdRef,
      recoveryPlan: { type: 'resumeAskingTask', taskId: 'task-1' },
      startThreadResponsePolling,
      stopThreadResponsePolling,
      threadResponseRequestInFlightRef,
    });

    expect(pollingAskingTaskIdRef.current).toBe('task-1');
    expect(pollingResponseIdRef.current).toBeNull();
    expect(askPrompt.onFetching).toHaveBeenCalledWith('task-1');
    expect(startThreadResponsePolling).not.toHaveBeenCalled();
  });

  it('cleans up polling state and closes the prompt ref', () => {
    const askPrompt = createAskPrompt();
    const promptRef = {
      current: { close: jest.fn(), submit: jest.fn() },
    } as any;

    const pollingAskingTaskIdRef = { current: 'task-1' as string | null };
    const pollingResponseIdRef = { current: 7 as number | null };
    const threadResponseRequestInFlightRef = { current: 7 as number | null };
    const threadRecommendRequestInFlightRef = { current: true };
    const stopThreadResponsePolling = jest.fn();
    const stopThreadRecommendPolling = jest.fn();

    createThreadRecoveryCleanup({
      askPrompt,
      pollingAskingTaskIdRef,
      pollingResponseIdRef,
      promptRef,
      stopThreadRecommendPolling,
      stopThreadResponsePolling,
      threadRecommendRequestInFlightRef,
      threadResponseRequestInFlightRef,
    })();

    expect(askPrompt.onStopPolling).toHaveBeenCalled();
    expect(askPrompt.onStopStreaming).toHaveBeenCalled();
    expect(askPrompt.onStopRecommend).toHaveBeenCalled();
    expect(stopThreadResponsePolling).toHaveBeenCalled();
    expect(stopThreadRecommendPolling).toHaveBeenCalled();
    expect(pollingAskingTaskIdRef.current).toBeNull();
    expect(pollingResponseIdRef.current).toBeNull();
    expect(threadResponseRequestInFlightRef.current).toBeNull();
    expect(threadRecommendRequestInFlightRef.current).toBe(false);
    expect(promptRef.current?.close).toHaveBeenCalled();
  });

  it('stores thread questions only when the signature changes', () => {
    const askPrompt = createAskPrompt();
    const storedQuestionsSignatureRef = { current: null as string | null };
    const responses = [
      { id: 1, question: 'How many orders?' },
      { id: 2, question: ['By region', 'By month'] },
    ] as any;

    syncThreadQuestionStore({
      askPrompt,
      responses,
      storedQuestionsSignatureRef,
    });
    syncThreadQuestionStore({
      askPrompt,
      responses,
      storedQuestionsSignatureRef,
    });

    expect(askPrompt.onStoreThreadQuestions).toHaveBeenCalledTimes(1);
    expect(askPrompt.onStoreThreadQuestions).toHaveBeenCalledWith([
      'How many orders?',
      'By region',
      'By month',
    ]);
  });

  it('dedupes thread response polling requests while preserving the stop timeout schedule', async () => {
    const pollingResponseIdRef = { current: null as number | null };
    const threadResponseRequestInFlightRef = { current: null as number | null };
    const scheduleThreadResponsePollingStop = jest.fn();
    const stopThreadResponsePolling = jest.fn();
    let resolveFetch!: () => void;
    const fetchThreadResponse = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    startThreadResponsePollingIfNeeded({
      fetchThreadResponse,
      pollingResponseIdRef,
      responseId: 7,
      scheduleThreadResponsePollingStop,
      stopThreadResponsePolling,
      threadResponseRequestInFlightRef,
    });
    startThreadResponsePollingIfNeeded({
      fetchThreadResponse,
      pollingResponseIdRef,
      responseId: 7,
      scheduleThreadResponsePollingStop,
      stopThreadResponsePolling,
      threadResponseRequestInFlightRef,
    });

    expect(fetchThreadResponse).toHaveBeenCalledTimes(1);
    expect(stopThreadResponsePolling).toHaveBeenCalledTimes(1);
    expect(scheduleThreadResponsePollingStop).toHaveBeenCalledTimes(1);

    resolveFetch();
    await Promise.resolve();
    await Promise.resolve();

    expect(threadResponseRequestInFlightRef.current).toBeNull();
    expect(scheduleThreadResponsePollingStop).toHaveBeenCalledTimes(2);
  });

  it('settles finished thread response polling and clears in-flight refs', () => {
    const pollingResponseIdRef = { current: 11 as number | null };
    const threadResponseRequestInFlightRef = { current: 11 as number | null };
    const stopThreadResponsePolling = jest.fn();
    const onThreadResponseSettled = jest.fn();

    settleFinishedThreadResponsePolling({
      onThreadResponseSettled,
      pollingResponseFinished: true,
      pollingResponseId: 11,
      pollingResponseIdRef,
      stopThreadResponsePolling,
      threadResponseRequestInFlightRef,
    });

    expect(stopThreadResponsePolling).toHaveBeenCalled();
    expect(pollingResponseIdRef.current).toBeNull();
    expect(threadResponseRequestInFlightRef.current).toBeNull();
    expect(onThreadResponseSettled).toHaveBeenCalled();
  });

  it('ignores finished polling payloads from a previous response id', () => {
    const pollingResponseIdRef = { current: 22 as number | null };
    const threadResponseRequestInFlightRef = { current: 22 as number | null };
    const stopThreadResponsePolling = jest.fn();
    const onThreadResponseSettled = jest.fn();

    settleFinishedThreadResponsePolling({
      onThreadResponseSettled,
      pollingResponseFinished: true,
      pollingResponseId: 11,
      pollingResponseIdRef,
      stopThreadResponsePolling,
      threadResponseRequestInFlightRef,
    });

    expect(stopThreadResponsePolling).not.toHaveBeenCalled();
    expect(pollingResponseIdRef.current).toBe(22);
    expect(threadResponseRequestInFlightRef.current).toBe(22);
    expect(onThreadResponseSettled).not.toHaveBeenCalled();
  });

  it('stops recommendation polling only after recommendation generation finishes', () => {
    const stopThreadRecommendPolling = jest.fn();
    const threadRecommendRequestInFlightRef = { current: true };

    syncThreadRecommendationPollingState({
      recommendedFinished: false,
      stopThreadRecommendPolling,
      threadRecommendRequestInFlightRef,
    });
    syncThreadRecommendationPollingState({
      recommendedFinished: true,
      stopThreadRecommendPolling,
      threadRecommendRequestInFlightRef,
    });

    expect(stopThreadRecommendPolling).toHaveBeenCalledTimes(1);
    expect(threadRecommendRequestInFlightRef.current).toBe(false);
  });
});
