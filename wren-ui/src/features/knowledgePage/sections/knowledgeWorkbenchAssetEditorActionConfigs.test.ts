import {
  buildKnowledgeWorkbenchRuleActionsResult,
  buildKnowledgeWorkbenchRuleAssetEditorActionsInput,
  buildKnowledgeWorkbenchRuleOpenEditorInput,
  buildKnowledgeWorkbenchSqlActionsResult,
  buildKnowledgeWorkbenchSqlAssetEditorActionsInput,
  buildKnowledgeWorkbenchSqlOpenEditorInput,
} from './knowledgeWorkbenchAssetEditorActionConfigs';

describe('knowledgeWorkbenchAssetEditorActionConfigs', () => {
  it('maps generic sql action handlers into the domain result shape', () => {
    const openSqlTemplateEditor = jest.fn(async () => true);

    const result = buildKnowledgeWorkbenchSqlActionsResult({
      applyContextDraft: jest.fn(),
      handleCloseDrawer: jest.fn(async () => true),
      handleCreateFromAsset: jest.fn(async () => undefined),
      handleDeleteItem: jest.fn(async () => undefined),
      handleDuplicateItem: jest.fn(async () => undefined),
      handleResetEditor: jest.fn(),
      handleSubmitDetail: jest.fn(async () => undefined),
      openSqlTemplateEditor,
    });

    expect(result).toMatchObject({
      applySqlContextDraft: expect.any(Function),
      handleCloseSqlTemplateDrawer: expect.any(Function),
      handleCreateSqlTemplateFromAsset: expect.any(Function),
      handleDeleteSqlTemplate: expect.any(Function),
      handleDuplicateSqlTemplate: expect.any(Function),
      handleResetSqlTemplateEditor: expect.any(Function),
      handleSubmitSqlTemplateDetail: expect.any(Function),
      openSqlTemplateEditor,
    });
  });

  it('maps generic rule action handlers into the domain result shape', () => {
    const openRuleEditor = jest.fn(async () => true);

    const result = buildKnowledgeWorkbenchRuleActionsResult({
      applyContextDraft: jest.fn(),
      handleCloseDrawer: jest.fn(async () => true),
      handleCreateFromAsset: jest.fn(async () => undefined),
      handleDeleteItem: jest.fn(async () => undefined),
      handleDuplicateItem: jest.fn(async () => undefined),
      handleResetEditor: jest.fn(),
      handleSubmitDetail: jest.fn(async () => undefined),
      openRuleEditor,
    });

    expect(result).toMatchObject({
      applyRuleContextDraft: expect.any(Function),
      handleCloseRuleDrawer: expect.any(Function),
      handleCreateRuleFromAsset: expect.any(Function),
      handleDeleteRule: expect.any(Function),
      handleDuplicateRule: expect.any(Function),
      handleResetRuleDetailEditor: expect.any(Function),
      handleSubmitRuleDetail: expect.any(Function),
      openRuleEditor,
    });
  });

  it('builds sql editor config with the expected section, labels and editor ids', () => {
    const result = buildKnowledgeWorkbenchSqlAssetEditorActionsInput({
      activeWorkbenchSection: 'sqlTemplates',
      editingSqlPair: { id: 8, question: 'Revenue', sql: 'select 1' } as any,
      isRuleDraftDirty: true,
      isSqlDraftDirty: false,
      onChangeWorkbenchSection: jest.fn(),
      onCreateSqlTemplateDraftFromAsset: jest.fn(),
      onDeleteSqlTemplate: jest.fn(),
      onOpenSqlTemplateDetail: jest.fn(),
      onResetSqlTemplateEditor: jest.fn(),
      onSubmitSqlTemplateDetail: jest.fn(),
      sqlTemplateForm: { setFieldsValue: jest.fn() },
      sqlTemplateDrawerOpen: true,
      syncSqlDraftBaseline: jest.fn(),
      setSqlContextAssetId: jest.fn(),
      setSqlTemplateDrawerOpen: jest.fn(),
      sqlContextAsset: { id: 'asset-sql' } as any,
      runWithDirtyGuard: jest.fn(async () => true),
      confirmDeleteEntry: jest.fn(async () => true),
    });

    expect(result).toMatchObject({
      applySuccessMessage: '已将参考资产内容带入当前 SQL 模板。',
      createFromAssetSuccessMessage: '已带入资产上下文，可继续完善 SQL 模板。',
      duplicateSuccessMessage: '已生成 SQL 模板草稿副本。',
      entityLabel: 'SQL 模板',
      targetSection: 'sqlTemplates',
      currentEditingId: 8,
      editingItemId: 8,
      counterpartSectionDirty: true,
      contextAsset: { id: 'asset-sql' },
    });
  });

  it('builds rule editor config with the expected section, labels and editor ids', () => {
    const result = buildKnowledgeWorkbenchRuleAssetEditorActionsInput({
      activeWorkbenchSection: 'instructions',
      editingInstruction: { id: 9, instruction: 'rule' } as any,
      isRuleDraftDirty: false,
      isSqlDraftDirty: true,
      onChangeWorkbenchSection: jest.fn(),
      onCreateRuleDraftFromAsset: jest.fn(),
      onDeleteRule: jest.fn(),
      onOpenRuleDetail: jest.fn(),
      onResetRuleDetailEditor: jest.fn(),
      onSubmitRuleDetail: jest.fn(),
      ruleDrawerOpen: false,
      ruleForm: { setFieldsValue: jest.fn() },
      syncRuleDraftBaseline: jest.fn(),
      setRuleContextAssetId: jest.fn(),
      setRuleDrawerOpen: jest.fn(),
      ruleContextAsset: { id: 'asset-rule' } as any,
      runWithDirtyGuard: jest.fn(async () => true),
      confirmDeleteEntry: jest.fn(async () => true),
    });

    expect(result).toMatchObject({
      applySuccessMessage: '已将参考资产内容带入当前分析规则。',
      createFromAssetSuccessMessage: '已带入资产上下文，可继续完善分析规则。',
      duplicateSuccessMessage: '已生成分析规则草稿副本。',
      entityLabel: '分析规则',
      targetSection: 'instructions',
      currentEditingId: 9,
      editingItemId: 9,
      counterpartSectionDirty: true,
      contextAsset: { id: 'asset-rule' },
    });
  });

  it('maps sql open-editor params into the generic editor input shape', () => {
    expect(
      buildKnowledgeWorkbenchSqlOpenEditorInput({
        sqlPair: { id: 1 } as any,
        draftValues: { sql: 'select 1' },
        contextAssetId: 'asset-1',
        switchSection: false,
      }),
    ).toEqual({
      item: { id: 1 },
      draftValues: { sql: 'select 1' },
      contextAssetId: 'asset-1',
      switchSection: false,
    });
  });

  it('maps rule open-editor params into the generic editor input shape', () => {
    expect(
      buildKnowledgeWorkbenchRuleOpenEditorInput({
        instruction: { id: 2 } as any,
        draftValues: { summary: 'Rule' },
        contextAssetId: 'asset-2',
        switchSection: true,
      }),
    ).toEqual({
      item: { id: 2 },
      draftValues: { summary: 'Rule' },
      contextAssetId: 'asset-2',
      switchSection: true,
    });
  });
});
