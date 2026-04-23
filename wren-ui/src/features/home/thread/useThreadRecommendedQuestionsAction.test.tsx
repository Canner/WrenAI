import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useThreadRecommendedQuestionsAction } from './useThreadRecommendedQuestionsAction';

const mockTriggerThreadResponseRecommendations = jest.fn();
const mockMessageError = jest.fn();

jest.mock('@/utils/threadRest', () => ({
  triggerThreadResponseRecommendations: (...args: any[]) =>
    mockTriggerThreadResponseRecommendations(...args),
}));

jest.mock('@/utils/antdAppBridge', () => ({
  appMessage: {
    error: (...args: any[]) => mockMessageError(...args),
  },
}));

describe('useThreadRecommendedQuestionsAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderHarness = (options?: {
    resolveResponseRuntimeScopeSelector?: (responseId: number) => {
      workspaceId: string;
      knowledgeBaseId: string;
      kbSnapshotId?: string;
      deployHash?: string;
    };
  }) => {
    let current: ReturnType<typeof useThreadRecommendedQuestionsAction> | null =
      null;

    const runtimeScopeSelector = {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    };
    const resolveResponseRuntimeScopeSelector =
      options?.resolveResponseRuntimeScopeSelector ||
      jest.fn(() => runtimeScopeSelector);
    const startThreadResponsePolling = jest.fn();
    const stopThreadResponsePolling = jest.fn();
    const upsertThreadResponse = jest.fn();

    const Harness = () => {
      current = useThreadRecommendedQuestionsAction({
        resolveResponseRuntimeScopeSelector,
        startThreadResponsePolling,
        stopThreadResponsePolling,
        upsertThreadResponse,
      });
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
      runtimeScopeSelector,
      resolveResponseRuntimeScopeSelector,
      startThreadResponsePolling,
      stopThreadResponsePolling,
      upsertThreadResponse,
    };
  };

  it('shows an error when the source response is not ready', async () => {
    const { hook, stopThreadResponsePolling } = renderHarness();

    await hook({ question: '推荐几个问题给我', responseId: null });

    expect(mockTriggerThreadResponseRecommendations).not.toHaveBeenCalled();
    expect(stopThreadResponsePolling).not.toHaveBeenCalled();
    expect(mockMessageError).toHaveBeenCalledWith(
      '当前回答尚未就绪，请稍后再试',
    );
  });

  it('triggers response-scoped recommendations and starts polling the new response', async () => {
    mockTriggerThreadResponseRecommendations.mockResolvedValue({
      id: 88,
      question: '推荐几个问题给我',
      recommendationDetail: {
        status: 'GENERATING',
        items: [],
      },
    });
    const {
      hook,
      runtimeScopeSelector,
      resolveResponseRuntimeScopeSelector,
      startThreadResponsePolling,
      stopThreadResponsePolling,
      upsertThreadResponse,
    } = renderHarness();

    const result = await hook({
      question: '推荐几个问题给我',
      responseId: 42,
    });

    expect(resolveResponseRuntimeScopeSelector).toHaveBeenCalledWith(42);
    expect(stopThreadResponsePolling).toHaveBeenCalled();
    expect(mockTriggerThreadResponseRecommendations).toHaveBeenCalledWith(
      runtimeScopeSelector,
      42,
      { question: '推荐几个问题给我' },
    );
    expect(upsertThreadResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 88,
      }),
    );
    expect(startThreadResponsePolling).toHaveBeenCalledWith(88);
    expect(result).toEqual(
      expect.objectContaining({
        id: 88,
      }),
    );
  });

  it('surfaces an error and returns null when recommendation generation fails', async () => {
    mockTriggerThreadResponseRecommendations.mockRejectedValue(
      new Error('boom'),
    );
    const { hook, startThreadResponsePolling, upsertThreadResponse } =
      renderHarness();

    const result = await hook({
      question: '推荐几个问题给我',
      responseId: 42,
    });

    expect(startThreadResponsePolling).not.toHaveBeenCalled();
    expect(upsertThreadResponse).not.toHaveBeenCalled();
    expect(mockMessageError).toHaveBeenCalledWith(
      '生成推荐追问失败，请稍后重试',
    );
    expect(result).toBeNull();
  });
});
