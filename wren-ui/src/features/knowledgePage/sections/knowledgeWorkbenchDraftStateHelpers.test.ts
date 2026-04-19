import {
  buildKnowledgeWorkbenchDraftDerivedStateInput,
  buildKnowledgeWorkbenchDraftStateResult,
  type KnowledgeWorkbenchDraftBaselineState,
  type KnowledgeWorkbenchContextAssetState,
  type KnowledgeWorkbenchDraftDerivedState,
  type KnowledgeWorkbenchDraftStateArgs,
  type KnowledgeWorkbenchDraftUiState,
  type KnowledgeWorkbenchDraftWatchValues,
} from './knowledgeWorkbenchDraftStateHelpers';

const createArgs = (): KnowledgeWorkbenchDraftStateArgs => ({
  detailAssets: [],
  ruleForm: { name: 'rule-form' },
  ruleList: [{ id: 1 } as any],
  sqlList: [{ id: 2 } as any],
  sqlTemplateForm: { name: 'sql-form' },
});

const createUiState = (): KnowledgeWorkbenchDraftUiState => ({
  ruleDrawerOpen: true,
  ruleListScope: 'matched',
  ruleSearchKeyword: 'rule-keyword',
  setRuleDrawerOpen: jest.fn(),
  setRuleListScope: jest.fn(),
  setRuleSearchKeyword: jest.fn(),
  setSqlListMode: jest.fn(),
  setSqlSearchKeyword: jest.fn(),
  setSqlTemplateDrawerOpen: jest.fn(),
  sqlListMode: 'recent',
  sqlSearchKeyword: 'sql-keyword',
  sqlTemplateDrawerOpen: false,
});

const createWatchValues = (): KnowledgeWorkbenchDraftWatchValues => ({
  watchedRuleContent: 'rule-content',
  watchedRuleScope: 'matched',
  watchedRuleSummary: 'rule-summary',
  watchedSqlContent: 'select 1',
  watchedSqlDescription: 'sql-description',
});

const createBaselineState = (): KnowledgeWorkbenchDraftBaselineState => ({
  ruleDraftBaseline: {
    summary: 'baseline-rule',
    scope: 'all',
    content: 'baseline-content',
  },
  sqlDraftBaseline: {
    description: 'baseline-sql',
    sql: 'select baseline',
    scope: 'all',
  },
  syncRuleDraftBaseline: jest.fn(),
  syncSqlDraftBaseline: jest.fn(),
});

const createContextAssetState = (): KnowledgeWorkbenchContextAssetState => ({
  ruleContextAsset: { id: 'rule-asset' } as any,
  ruleContextAssetId: 'rule-asset',
  setRuleContextAssetId: jest.fn(),
  setSqlContextAssetId: jest.fn(),
  sqlContextAsset: { id: 'sql-asset' } as any,
  sqlContextAssetId: 'sql-asset',
  sqlTemplateAssetOptions: [{ label: 'Orders', value: 'orders' }],
});

const createDerivedState = (): KnowledgeWorkbenchDraftDerivedState => ({
  isRuleDraftDirty: true,
  isSqlDraftDirty: false,
  visibleRuleList: [{ id: 3 } as any],
  visibleSqlList: [{ id: 4 } as any],
});

describe('knowledgeWorkbenchDraftStateHelpers', () => {
  it('builds derived-state input from args, baselines, ui state and watch values', () => {
    const result = buildKnowledgeWorkbenchDraftDerivedStateInput({
      args: createArgs(),
      baselineState: createBaselineState(),
      uiState: createUiState(),
      watchValues: createWatchValues(),
    });

    expect(result).toMatchObject({
      ruleList: [{ id: 1 }],
      sqlList: [{ id: 2 }],
      ruleListScope: 'matched',
      sqlListMode: 'recent',
      watchedRuleSummary: 'rule-summary',
      watchedSqlContent: 'select 1',
    });
  });

  it('merges ui, baseline, context asset and derived state into the draft hook result', () => {
    const uiState = createUiState();
    const baselineState = createBaselineState();
    const contextAssetState = createContextAssetState();
    const derivedState = createDerivedState();

    const result = buildKnowledgeWorkbenchDraftStateResult({
      baselineState,
      contextAssetState,
      derivedState,
      uiState,
    });

    expect(result).toMatchObject({
      isRuleDraftDirty: true,
      isSqlDraftDirty: false,
      ruleContextAssetId: 'rule-asset',
      sqlContextAssetId: 'sql-asset',
      ruleDrawerOpen: true,
      sqlTemplateDrawerOpen: false,
      ruleListScope: 'matched',
      sqlListMode: 'recent',
      visibleRuleList: [{ id: 3 }],
      visibleSqlList: [{ id: 4 }],
      syncRuleDraftBaseline: baselineState.syncRuleDraftBaseline,
      syncSqlDraftBaseline: baselineState.syncSqlDraftBaseline,
    });
  });
});
