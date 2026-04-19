import {
  buildKnowledgeInstructionsStageProps,
  buildKnowledgeModelingSectionProps,
  buildKnowledgeOverviewStageProps,
  buildKnowledgeSqlTemplatesStageProps,
  buildKnowledgeWorkbenchHeaderProps,
} from './buildKnowledgeMainStageSectionProps';

describe('buildKnowledgeMainStageSectionProps', () => {
  it('builds header props without altering readonly metadata', () => {
    const props = buildKnowledgeWorkbenchHeaderProps({
      activeWorkbenchSection: 'overview',
      previewFieldCount: 12,
      isSnapshotReadonlyKnowledgeBase: true,
      isReadonlyKnowledgeBase: false,
      isKnowledgeMutationDisabled: true,
      knowledgeMutationHint: 'readonly',
      knowledgeDescription: 'desc',
      onOpenKnowledgeEditor: jest.fn(),
      onChangeWorkbenchSection: jest.fn(),
    });

    expect(props.previewFieldCount).toBe(12);
    expect(props.isSnapshotReadonlyKnowledgeBase).toBe(true);
    expect(props.knowledgeMutationHint).toBe('readonly');
  });

  it('derives overview counts from rule/sql lists', () => {
    const props = buildKnowledgeOverviewStageProps({
      activeWorkbenchSection: 'overview',
      activeDetailAsset: null,
      detailAssetFields: [],
      detailAssets: [],
      detailFieldFilter: 'all',
      detailFieldKeyword: '',
      detailTab: 'overview',
      historicalSnapshotReadonlyHint: 'snapshot',
      isKnowledgeMutationDisabled: false,
      isReadonlyKnowledgeBase: false,
      isSnapshotReadonlyKnowledgeBase: false,
      modelingSummary: { modelCount: 1, relationCount: 2, viewCount: 3 },
      onChangeDetailTab: jest.fn(),
      onChangeFieldFilter: jest.fn(),
      onChangeFieldKeyword: jest.fn(),
      onCloseAssetDetail: jest.fn(),
      onCreateRuleDraft: jest.fn(),
      onCreateSqlTemplateDraft: jest.fn(),
      onOpenAssetDetail: jest.fn(),
      onOpenAssetWizard: jest.fn(),
      onOpenModeling: jest.fn(),
      previewFieldCount: 10,
      ruleList: [{ id: 'r1' }, { id: 'r2' }] as any,
      showKnowledgeAssetsLoading: false,
      sqlList: [{ id: 's1' }] as any,
    });

    expect(props.ruleListCount).toBe(2);
    expect(props.sqlListCount).toBe(1);
    expect(props.previewFieldCount).toBe(10);
  });

  it('passes modeling summary props through unchanged', () => {
    const props = buildKnowledgeModelingSectionProps({
      modelingSummary: { modelCount: 1, relationCount: 2, viewCount: 3 },
      modelingWorkspaceKey: 'kb:workspace',
      workbenchModeLabel: '可编辑',
    });

    expect(props.modelingWorkspaceKey).toBe('kb:workspace');
    expect(props.workbenchModeLabel).toBe('可编辑');
  });

  it('maps sql and instruction stage props from shared editor state', () => {
    const editors = {
      applyRuleContextDraft: jest.fn(),
      applySqlContextDraft: jest.fn(),
      handleCloseRuleDrawer: jest.fn(),
      handleCloseSqlTemplateDrawer: jest.fn(),
      handleCreateRuleFromAsset: jest.fn(),
      handleCreateSqlTemplateFromAsset: jest.fn(),
      handleDeleteRule: jest.fn(),
      handleDeleteSqlTemplate: jest.fn(),
      handleDuplicateRule: jest.fn(),
      handleDuplicateSqlTemplate: jest.fn(),
      handleResetRuleDetailEditor: jest.fn(),
      handleResetSqlTemplateEditor: jest.fn(),
      handleSubmitRuleDetail: jest.fn(),
      handleSubmitSqlTemplateDetail: jest.fn(),
      openRuleEditor: jest.fn(),
      openSqlTemplateEditor: jest.fn(),
      ruleContextAsset: null,
      ruleContextAssetId: 'asset-rule',
      ruleDrawerOpen: true,
      ruleListScope: 'all' as const,
      ruleSearchKeyword: 'rule',
      setRuleContextAssetId: jest.fn(),
      setRuleListScope: jest.fn(),
      setRuleSearchKeyword: jest.fn(),
      setSqlContextAssetId: jest.fn(),
      setSqlListMode: jest.fn(),
      setSqlSearchKeyword: jest.fn(),
      sqlContextAsset: null,
      sqlContextAssetId: 'asset-sql',
      sqlListMode: 'recent' as const,
      sqlSearchKeyword: 'sql',
      sqlTemplateAssetOptions: [{ label: 'Asset A', value: 'asset-a' }],
      sqlTemplateDrawerOpen: true,
      visibleRuleList: [] as any[],
      visibleSqlList: [] as any[],
    } as any;

    const sqlProps = buildKnowledgeSqlTemplatesStageProps({
      createSqlPairLoading: true,
      editingSqlPair: null,
      editors,
      isKnowledgeMutationDisabled: false,
      sqlList: [],
      sqlManageLoading: false,
      sqlTemplateForm: {} as any,
      updateSqlPairLoading: false,
    });

    const ruleProps = buildKnowledgeInstructionsStageProps({
      createInstructionLoading: true,
      editingInstruction: null,
      editors,
      isKnowledgeMutationDisabled: false,
      ruleForm: {} as any,
      ruleList: [],
      ruleManageLoading: false,
      updateInstructionLoading: false,
    });

    expect(sqlProps.sqlContextAssetId).toBe('asset-sql');
    expect(sqlProps.sqlListMode).toBe('recent');
    expect(ruleProps.ruleContextAssetId).toBe('asset-rule');
    expect(ruleProps.ruleListScope).toBe('all');
    expect(ruleProps.assetOptions).toEqual([
      { label: 'Asset A', value: 'asset-a' },
    ]);
  });
});
