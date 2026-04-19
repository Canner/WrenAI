import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { message } from 'antd';
import { useThreadResponseMutationActions } from './useThreadResponseMutationActions';

const mockAdjustThreadResponseChart = jest.fn();
const mockTriggerThreadResponseAnswer = jest.fn();
const mockTriggerThreadResponseChart = jest.fn();
const mockUpdateThreadResponseSql = jest.fn();

jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/utils/threadRest', () => ({
  adjustThreadResponseChart: (...args: any[]) =>
    mockAdjustThreadResponseChart(...args),
  triggerThreadResponseAnswer: (...args: any[]) =>
    mockTriggerThreadResponseAnswer(...args),
  triggerThreadResponseChart: (...args: any[]) =>
    mockTriggerThreadResponseChart(...args),
  updateThreadResponseSql: (...args: any[]) =>
    mockUpdateThreadResponseSql(...args),
}));

describe('useThreadResponseMutationActions', () => {
  const mockMessageError = message.error as jest.Mock;
  const mockMessageSuccess = message.success as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderHarness = () => {
    let current: ReturnType<typeof useThreadResponseMutationActions> | null =
      null;

    const runtimeScopeSelector = {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
    };
    const startThreadResponsePolling = jest.fn();
    const upsertThreadResponse = jest.fn();

    const Harness = () => {
      current = useThreadResponseMutationActions({
        runtimeScopeSelector,
        startThreadResponsePolling,
        upsertThreadResponse,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useThreadResponseMutationActions');
    }

    return {
      hook: current as ReturnType<typeof useThreadResponseMutationActions>,
      runtimeScopeSelector,
      startThreadResponsePolling,
      upsertThreadResponse,
    };
  };

  it('generates an answer and starts polling', async () => {
    mockTriggerThreadResponseAnswer.mockResolvedValue({
      id: 9,
      question: '继续分析',
    });
    const {
      hook,
      runtimeScopeSelector,
      startThreadResponsePolling,
      upsertThreadResponse,
    } = renderHarness();

    await hook.onGenerateThreadResponseAnswer(9);

    expect(mockTriggerThreadResponseAnswer).toHaveBeenCalledWith(
      runtimeScopeSelector,
      9,
    );
    expect(upsertThreadResponse).toHaveBeenCalledWith(
      expect.objectContaining({ id: 9 }),
    );
    expect(startThreadResponsePolling).toHaveBeenCalledWith(9);
  });

  it('adjusts a chart and upserts the response', async () => {
    mockAdjustThreadResponseChart.mockResolvedValue({
      id: 12,
      question: '图表',
    });
    const { hook, runtimeScopeSelector, upsertThreadResponse } =
      renderHarness();

    await hook.onAdjustThreadResponseChart(12, {
      chartSchema: { mark: 'bar' },
    } as any);

    expect(mockAdjustThreadResponseChart).toHaveBeenCalledWith(
      runtimeScopeSelector,
      12,
      expect.objectContaining({
        chartSchema: { mark: 'bar' },
      }),
    );
    expect(upsertThreadResponse).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12 }),
    );
  });

  it('updates SQL, reports success, and regenerates the answer', async () => {
    mockUpdateThreadResponseSql.mockResolvedValue({
      id: 15,
      question: 'SQL 修正',
    });
    mockTriggerThreadResponseAnswer.mockResolvedValue({
      id: 15,
      question: 'SQL 修正',
    });
    const {
      hook,
      runtimeScopeSelector,
      startThreadResponsePolling,
      upsertThreadResponse,
    } = renderHarness();

    await hook.onFixSQLStatement(15, 'select 1');

    expect(mockUpdateThreadResponseSql).toHaveBeenCalledWith(
      runtimeScopeSelector,
      15,
      { sql: 'select 1' },
    );
    expect(mockMessageSuccess).toHaveBeenCalledWith('SQL 语句已更新。');
    expect(mockTriggerThreadResponseAnswer).toHaveBeenCalledWith(
      runtimeScopeSelector,
      15,
    );
    expect(upsertThreadResponse).toHaveBeenCalled();
    expect(startThreadResponsePolling).toHaveBeenCalledWith(15);
  });

  it('shows error feedback when chart generation fails', async () => {
    mockTriggerThreadResponseChart.mockRejectedValue(new Error('boom'));
    const { hook } = renderHarness();

    await hook.onGenerateThreadResponseChart(30);

    expect(mockMessageError).toHaveBeenCalledWith('生成图表失败，请稍后重试');
  });
});
