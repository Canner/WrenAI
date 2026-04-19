import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { message } from 'antd';
import { useThreadCreateResponseAction } from './useThreadCreateResponseAction';

const mockCreateThreadResponse = jest.fn();

jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
  },
}));

jest.mock('@/utils/threadRest', () => ({
  createThreadResponse: (...args: any[]) => mockCreateThreadResponse(...args),
}));

jest.mock('./threadPageState', () => ({
  hydrateCreatedThreadResponse: jest.fn(
    ({ response, taskId }: { response: any; taskId?: string }) =>
      taskId
        ? {
            ...response,
            askingTask: {
              queryId: taskId,
              status: 'SEARCHING',
            },
          }
        : response,
  ),
  resolveCreatedThreadResponsePollingTaskId: jest.fn(
    ({ response, taskId }: { response: any; taskId?: string | null }) =>
      response.askingTask?.queryId || taskId || null,
  ),
}));

describe('useThreadCreateResponseAction', () => {
  const mockMessageError = message.error as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderHarness = (
    props: Partial<Parameters<typeof useThreadCreateResponseAction>[0]> = {},
  ) => {
    let current: ReturnType<typeof useThreadCreateResponseAction> | null = null;

    const resolvedProps = {
      askPrompt: {
        data: {
          askingTask: {
            queryId: 'query-1',
            status: 'SEARCHING',
            type: 'TEXT_TO_SQL',
            candidates: [],
          },
        },
        onFetching: jest.fn().mockResolvedValue(undefined),
        onStopPolling: jest.fn(),
      },
      currentThreadId: 42,
      pollingAskingTaskIdRef: { current: null as string | null },
      pollingResponseIdRef: { current: 99 as number | null },
      runtimeScopeSelector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      },
      setShowRecommendedQuestions: jest.fn(),
      stopThreadResponsePolling: jest.fn(),
      threadResponseRequestInFlightRef: { current: 100 as number | null },
      upsertThreadResponse: jest.fn(),
      ...props,
    };

    const Harness = () => {
      current = useThreadCreateResponseAction(resolvedProps);
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useThreadCreateResponseAction');
    }

    return {
      hook: current as ReturnType<typeof useThreadCreateResponseAction>,
      props: resolvedProps,
    };
  };

  it('shows an error when the thread is not ready', async () => {
    const { hook, props } = renderHarness({
      currentThreadId: null,
    });

    await hook({
      question: '为什么没结果',
    } as any);

    expect(props.askPrompt.onStopPolling).toHaveBeenCalled();
    expect(props.stopThreadResponsePolling).toHaveBeenCalled();
    expect(mockCreateThreadResponse).not.toHaveBeenCalled();
    expect(mockMessageError).toHaveBeenCalledWith(
      '当前对话尚未就绪，请稍后再试',
    );
  });

  it('creates a response, hydrates the polling task, and starts follow-up fetching', async () => {
    mockCreateThreadResponse.mockResolvedValue({
      id: 7,
      status: 'SEARCHING',
      question: '追问',
      askingTask: null,
    });
    const { hook, props } = renderHarness();

    await hook({
      question: '继续分析',
      taskId: 'query-2',
    } as any);

    expect(mockCreateThreadResponse).toHaveBeenCalledWith(
      props.runtimeScopeSelector,
      42,
      expect.objectContaining({
        question: '继续分析',
        taskId: 'query-2',
      }),
    );
    expect(props.upsertThreadResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        askingTask: expect.objectContaining({
          queryId: 'query-2',
        }),
      }),
    );
    expect(props.setShowRecommendedQuestions).toHaveBeenCalledWith(false);
    expect(props.pollingAskingTaskIdRef.current).toBe('query-2');
    expect(props.pollingResponseIdRef.current).toBeNull();
    expect(props.threadResponseRequestInFlightRef.current).toBeNull();
    expect(props.askPrompt.onFetching).toHaveBeenCalledWith('query-2');
  });
});
