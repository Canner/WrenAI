import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { message } from 'antd';
import { useThreadRecommendedQuestionsAction } from './useThreadRecommendedQuestionsAction';

const mockTriggerThreadRecommendationQuestions = jest.fn();

jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
  },
}));

jest.mock('@/utils/threadRest', () => ({
  triggerThreadRecommendationQuestions: (...args: any[]) =>
    mockTriggerThreadRecommendationQuestions(...args),
}));

describe('useThreadRecommendedQuestionsAction', () => {
  const mockMessageError = message.error as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderHarness = (
    props: Partial<
      Parameters<typeof useThreadRecommendedQuestionsAction>[0]
    > = {},
  ) => {
    let current: ReturnType<typeof useThreadRecommendedQuestionsAction> | null =
      null;

    const resolvedProps = {
      currentThreadId: 42,
      fetchThreadRecommendationQuestions: jest
        .fn()
        .mockResolvedValue(undefined),
      runtimeScopeSelector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      },
      scheduleThreadRecommendPollingStop: jest.fn(),
      setShowRecommendedQuestions: jest.fn(),
      stopThreadRecommendPolling: jest.fn(),
      threadRecommendRequestInFlightRef: { current: false },
      ...props,
    };

    const Harness = () => {
      current = useThreadRecommendedQuestionsAction(resolvedProps);
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error(
        'Failed to initialize useThreadRecommendedQuestionsAction',
      );
    }

    return {
      hook: current as ReturnType<typeof useThreadRecommendedQuestionsAction>,
      props: resolvedProps,
    };
  };

  it('shows an error when the thread is not ready', async () => {
    const { hook, props } = renderHarness({
      currentThreadId: null,
    });

    await hook();

    expect(mockTriggerThreadRecommendationQuestions).not.toHaveBeenCalled();
    expect(props.stopThreadRecommendPolling).not.toHaveBeenCalled();
    expect(mockMessageError).toHaveBeenCalledWith(
      '当前对话尚未就绪，请稍后再试',
    );
  });

  it('does nothing when a recommendation request is already in flight', async () => {
    const { hook, props } = renderHarness({
      threadRecommendRequestInFlightRef: { current: true },
    });

    await hook();

    expect(mockTriggerThreadRecommendationQuestions).not.toHaveBeenCalled();
    expect(props.setShowRecommendedQuestions).not.toHaveBeenCalled();
  });

  it('triggers recommendation questions, fetches results, and resets the in-flight flag', async () => {
    mockTriggerThreadRecommendationQuestions.mockResolvedValue({
      success: true,
    });
    const { hook, props } = renderHarness();

    await hook();
    await Promise.resolve();

    expect(props.setShowRecommendedQuestions).toHaveBeenCalledWith(true);
    expect(props.stopThreadRecommendPolling).toHaveBeenCalled();
    expect(mockTriggerThreadRecommendationQuestions).toHaveBeenCalledWith(
      props.runtimeScopeSelector,
      42,
    );
    expect(props.fetchThreadRecommendationQuestions).toHaveBeenCalledWith(42);
    expect(props.scheduleThreadRecommendPollingStop).toHaveBeenCalled();
    expect(props.threadRecommendRequestInFlightRef.current).toBe(false);
  });
});
