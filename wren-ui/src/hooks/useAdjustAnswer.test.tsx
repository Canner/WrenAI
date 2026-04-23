import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useAdjustAnswer from './useAdjustAnswer';

const mockAdjustThreadResponseAnswer = jest.fn();
const mockCancelAdjustmentTask = jest.fn();
const mockRerunAdjustmentTask = jest.fn();
const mockFetchThreadResponse = jest.fn();
const mockStopPolling = jest.fn();
const mockMessageError = jest.fn();
const mockMessageWarning = jest.fn();

jest.mock('@/utils/homeRest', () => ({
  adjustThreadResponseAnswer: (...args: any[]) =>
    mockAdjustThreadResponseAnswer(...args),
  cancelAdjustmentTask: (...args: any[]) => mockCancelAdjustmentTask(...args),
  rerunAdjustmentTask: (...args: any[]) => mockRerunAdjustmentTask(...args),
}));

jest.mock('./useThreadResponsePolling', () => ({
  __esModule: true,
  default: () => ({
    data: null,
    fetchById: (...args: any[]) => mockFetchThreadResponse(...args),
    stopPolling: (...args: any[]) => mockStopPolling(...args),
  }),
}));

jest.mock('@/utils/antdAppBridge', () => ({
  appMessage: {
    error: (...args: any[]) => mockMessageError(...args),
    warning: (...args: any[]) => mockMessageWarning(...args),
  },
}));

describe('useAdjustAnswer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const renderHarness = () => {
    let current: ReturnType<typeof useAdjustAnswer> | null = null;
    const runtimeScopeSelector = {
      workspaceId: 'ws-current',
      knowledgeBaseId: 'kb-current',
    };
    const scopedSelector = {
      workspaceId: 'ws-response',
      knowledgeBaseId: 'kb-response',
      kbSnapshotId: 'snap-response',
      deployHash: 'deploy-response',
    };
    const resolveResponseRuntimeScopeSelector = jest.fn((responseId: number) =>
      responseId === 11 || responseId === 77
        ? scopedSelector
        : runtimeScopeSelector,
    );

    const Harness = () => {
      current = useAdjustAnswer(
        19,
        jest.fn(),
        runtimeScopeSelector,
        resolveResponseRuntimeScopeSelector,
      );
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useAdjustAnswer');
    }

    return {
      hook: current as ReturnType<typeof useAdjustAnswer>,
      runtimeScopeSelector,
      scopedSelector,
      resolveResponseRuntimeScopeSelector,
    };
  };

  it('uses the persisted response runtime selector for adjustment requests, polling, and stop actions', async () => {
    mockAdjustThreadResponseAnswer.mockResolvedValue({
      id: 77,
      adjustmentTask: {
        queryId: 'adjust-q-1',
      },
    });
    mockFetchThreadResponse.mockResolvedValue({
      id: 77,
    });
    mockCancelAdjustmentTask.mockResolvedValue({ success: true });

    const { hook, scopedSelector, resolveResponseRuntimeScopeSelector } =
      renderHarness();

    await hook.onAdjustReasoningSteps(11, {
      tables: ['orders'],
      sqlGenerationReasoning: 'reasoning',
    });

    expect(resolveResponseRuntimeScopeSelector).toHaveBeenCalledWith(11);
    expect(mockAdjustThreadResponseAnswer).toHaveBeenCalledWith(
      scopedSelector,
      11,
      {
        tables: ['orders'],
        sqlGenerationReasoning: 'reasoning',
      },
    );
    expect(mockFetchThreadResponse).toHaveBeenCalledWith(77, scopedSelector);

    await hook.onStop('adjust-q-1');

    expect(mockCancelAdjustmentTask).toHaveBeenCalledWith(
      scopedSelector,
      'adjust-q-1',
    );
  });
});
