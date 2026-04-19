import { buildKnowledgeMainStageEditorsInput } from './buildKnowledgeMainStageEditorsInput';

describe('buildKnowledgeMainStageEditorsInput', () => {
  it('maps main-stage editor wiring into the shared editors hook input', () => {
    const args = {
      activeWorkbenchSection: 'sqlTemplates' as const,
      detailAssets: [{ id: 'asset-1' }] as any,
      editingInstruction: { id: 'rule-1' } as any,
      editingSqlPair: { id: 'sql-1' } as any,
      onChangeWorkbenchSection: jest.fn(),
      onCreateRuleDraftFromAsset: jest.fn(),
      onCreateSqlTemplateDraftFromAsset: jest.fn(),
      onDeleteRule: jest.fn(),
      onDeleteSqlTemplate: jest.fn(),
      onOpenRuleDetail: jest.fn(),
      onOpenSqlTemplateDetail: jest.fn(),
      onResetRuleDetailEditor: jest.fn(),
      onResetSqlTemplateEditor: jest.fn(),
      onSubmitRuleDetail: jest.fn(),
      onSubmitSqlTemplateDetail: jest.fn(),
      ruleForm: {} as any,
      ruleList: [{ id: 'rule-1' }] as any,
      sqlList: [{ id: 'sql-1' }] as any,
      sqlTemplateForm: {} as any,
    };

    const result = buildKnowledgeMainStageEditorsInput(args);

    expect(result).toEqual(args);
  });
});
