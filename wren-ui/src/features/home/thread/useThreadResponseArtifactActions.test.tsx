import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { message } from 'antd';
import { useThreadResponseArtifactActions } from './useThreadResponseArtifactActions';

const mockCreateKnowledgeSqlPair = jest.fn();
const mockCreateViewFromResponse = jest.fn();

jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/utils/knowledgeRuleSqlRest', () => ({
  createKnowledgeSqlPair: (...args: any[]) =>
    mockCreateKnowledgeSqlPair(...args),
}));

jest.mock('@/utils/viewRest', () => ({
  createViewFromResponse: (...args: any[]) =>
    mockCreateViewFromResponse(...args),
}));

describe('useThreadResponseArtifactActions', () => {
  const mockMessageError = message.error as jest.Mock;
  const mockMessageSuccess = message.success as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderHarness = () => {
    let current: ReturnType<typeof useThreadResponseArtifactActions> | null =
      null;

    const runtimeScopeSelector = {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
    };

    const Harness = () => {
      current = useThreadResponseArtifactActions({
        runtimeScopeSelector,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useThreadResponseArtifactActions');
    }

    return {
      hook: current as ReturnType<typeof useThreadResponseArtifactActions>,
      runtimeScopeSelector,
    };
  };

  it('creates a saved view and shows success feedback', async () => {
    mockCreateViewFromResponse.mockResolvedValue({ success: true });
    const { hook, runtimeScopeSelector } = renderHarness();

    await hook.handleCreateView({
      name: '经营概览',
      rephrasedQuestion: '看看本月情况',
      responseId: 11,
    });

    expect(mockCreateViewFromResponse).toHaveBeenCalledWith(
      runtimeScopeSelector,
      expect.objectContaining({
        responseId: 11,
      }),
    );
    expect(mockMessageSuccess).toHaveBeenCalledWith('视图已创建。');
  });

  it('creates a SQL pair and resets loading on failure', async () => {
    mockCreateKnowledgeSqlPair.mockRejectedValue(new Error('boom'));
    const { hook, runtimeScopeSelector } = renderHarness();

    await expect(
      hook.handleCreateSqlPair({
        sql: 'select 1',
        question: 'Revenue',
      } as any),
    ).rejects.toThrow('boom');

    expect(mockCreateKnowledgeSqlPair).toHaveBeenCalledWith(
      runtimeScopeSelector,
      expect.objectContaining({
        sql: 'select 1',
      }),
    );
    expect(mockMessageError).toHaveBeenCalledWith(
      '保存 SQL 模板失败，请稍后重试',
    );
  });
});
