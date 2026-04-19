import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useKnowledgeWorkbenchDraftUiState } from './useKnowledgeWorkbenchDraftUiState';

describe('useKnowledgeWorkbenchDraftUiState', () => {
  const renderHarness = () => {
    let current: ReturnType<typeof useKnowledgeWorkbenchDraftUiState> | null =
      null;

    const Harness = () => {
      current = useKnowledgeWorkbenchDraftUiState();
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useKnowledgeWorkbenchDraftUiState');
    }

    return current as ReturnType<typeof useKnowledgeWorkbenchDraftUiState>;
  };

  it('provides the expected default editor ui state', () => {
    const hookValue = renderHarness();

    expect(hookValue.ruleDrawerOpen).toBe(false);
    expect(hookValue.sqlTemplateDrawerOpen).toBe(false);
    expect(hookValue.ruleListScope).toBe('all');
    expect(hookValue.sqlListMode).toBe('all');
    expect(hookValue.ruleSearchKeyword).toBe('');
    expect(hookValue.sqlSearchKeyword).toBe('');
  });
});
