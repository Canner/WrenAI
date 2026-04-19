import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Form } from 'antd';
import { useKnowledgeWorkbenchDraftWatchValues } from './useKnowledgeWorkbenchDraftWatchValues';

jest.mock('antd', () => ({
  Form: {
    useWatch: jest.fn(),
  },
}));

describe('useKnowledgeWorkbenchDraftWatchValues', () => {
  const mockUseWatch = Form.useWatch as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWatch.mockImplementation(
      (name: string, form: any) => `${form.name}:${name}`,
    );
  });

  const renderHarness = () => {
    let current: ReturnType<
      typeof useKnowledgeWorkbenchDraftWatchValues
    > | null = null;
    const ruleForm = { name: 'ruleForm' };
    const sqlTemplateForm = { name: 'sqlForm' };

    const Harness = () => {
      current = useKnowledgeWorkbenchDraftWatchValues({
        ruleForm,
        sqlTemplateForm,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error(
        'Failed to initialize useKnowledgeWorkbenchDraftWatchValues',
      );
    }

    return {
      hook: current as ReturnType<typeof useKnowledgeWorkbenchDraftWatchValues>,
      ruleForm,
      sqlTemplateForm,
    };
  };

  it('watches the expected rule and sql fields from each form', () => {
    const { hook, ruleForm, sqlTemplateForm } = renderHarness();

    expect(mockUseWatch).toHaveBeenNthCalledWith(1, 'summary', ruleForm);
    expect(mockUseWatch).toHaveBeenNthCalledWith(2, 'scope', ruleForm);
    expect(mockUseWatch).toHaveBeenNthCalledWith(3, 'content', ruleForm);
    expect(mockUseWatch).toHaveBeenNthCalledWith(
      4,
      'description',
      sqlTemplateForm,
    );
    expect(mockUseWatch).toHaveBeenNthCalledWith(5, 'sql', sqlTemplateForm);
    expect(hook).toEqual({
      watchedRuleContent: 'ruleForm:content',
      watchedRuleScope: 'ruleForm:scope',
      watchedRuleSummary: 'ruleForm:summary',
      watchedSqlContent: 'sqlForm:sql',
      watchedSqlDescription: 'sqlForm:description',
    });
  });
});
