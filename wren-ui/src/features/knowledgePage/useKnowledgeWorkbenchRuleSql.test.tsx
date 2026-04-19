import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchRuleSql from './useKnowledgeWorkbenchRuleSql';

const mockUseKnowledgeRuleSqlActions = jest.fn();
const mockUseKnowledgeRuleSqlManager = jest.fn();

jest.mock('@/hooks/useKnowledgeRuleSqlActions', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeRuleSqlActions(...args),
}));

jest.mock('@/hooks/useKnowledgeRuleSqlManager', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeRuleSqlManager(...args),
}));

describe('useKnowledgeWorkbenchRuleSql', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKnowledgeRuleSqlActions.mockReturnValue({
      createInstructionLoading: true,
      updateInstructionLoading: false,
      createSqlPairLoading: false,
      updateSqlPairLoading: true,
      createInstruction: jest.fn(),
      updateInstruction: jest.fn(),
      deleteInstruction: jest.fn(),
      createSqlPair: jest.fn(),
      updateSqlPair: jest.fn(),
      deleteSqlPair: jest.fn(),
      refetchInstructions: jest.fn(async () => ({
        data: { instructions: [] },
      })),
      refetchSqlPairs: jest.fn(async () => ({ data: { sqlPairs: [] } })),
    });
    mockUseKnowledgeRuleSqlManager.mockReturnValue({
      ruleManageLoading: false,
      ruleList: [{ id: 1, instruction: 'rule' }],
      loadRuleList: jest.fn(),
      editingInstruction: null,
      sqlManageLoading: false,
      sqlList: [{ id: 1, sql: 'select 1', question: 'demo' }],
      loadSqlList: jest.fn(),
      editingSqlPair: null,
      openRuleDetail: jest.fn(),
      openSqlTemplateDetail: jest.fn(),
      handleDeleteRule: jest.fn(),
      handleDeleteSqlTemplate: jest.fn(),
      submitRuleDetail: jest.fn(),
      submitSqlTemplateDetail: jest.fn(),
      resetRuleDetailEditor: jest.fn(),
      resetSqlTemplateEditor: jest.fn(),
      resetRuleSqlManagerState: jest.fn(),
    });
  });

  const renderHookHarness = () => {
    let current!: ReturnType<typeof useKnowledgeWorkbenchRuleSql>;

    const Harness = () => {
      current = useKnowledgeWorkbenchRuleSql({
        cacheScopeKey: 'scope-key',
        runtimeSelector: { workspaceId: 'ws-1', knowledgeBaseId: 'kb-1' },
        ruleForm: { setFieldsValue: jest.fn(), resetFields: jest.fn() } as any,
        sqlTemplateForm: {
          setFieldsValue: jest.fn(),
          resetFields: jest.fn(),
        } as any,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('composes rule/sql action and manager hooks into a single workbench surface', () => {
    const hookValue = renderHookHarness();

    expect(hookValue.createInstructionLoading).toBe(true);
    expect(hookValue.updateSqlPairLoading).toBe(true);
    expect(hookValue.ruleList).toEqual([{ id: 1, instruction: 'rule' }]);
    expect(hookValue.sqlList).toEqual([
      { id: 1, sql: 'select 1', question: 'demo' },
    ]);
    expect(mockUseKnowledgeRuleSqlActions).toHaveBeenCalled();
    expect(mockUseKnowledgeRuleSqlManager).toHaveBeenCalled();
  });
});
