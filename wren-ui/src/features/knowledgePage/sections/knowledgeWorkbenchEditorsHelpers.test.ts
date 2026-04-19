import { buildKnowledgeWorkbenchEditorActionsInput } from './buildKnowledgeWorkbenchEditorActionsInput';
import { buildKnowledgeWorkbenchEditorsResult } from './buildKnowledgeWorkbenchEditorsResult';
import type {
  KnowledgeWorkbenchEditorsActions,
  KnowledgeWorkbenchEditorsArgs,
  KnowledgeWorkbenchEditorsDraftState,
} from './knowledgeWorkbenchEditorsTypes';
import { buildKnowledgeWorkbenchDraftStateInput } from './buildKnowledgeWorkbenchDraftStateInput';

const createArgs = (): KnowledgeWorkbenchEditorsArgs => ({
  activeWorkbenchSection: 'sqlTemplates',
  detailAssets: [],
  editingInstruction: { id: 1 } as any,
  editingSqlPair: { id: 2 } as any,
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
  ruleForm: { form: 'rule' },
  ruleList: [],
  sqlList: [],
  sqlTemplateForm: { form: 'sql' },
});

const createDraftState = (): KnowledgeWorkbenchEditorsDraftState => ({
  isRuleDraftDirty: true,
  isSqlDraftDirty: false,
  ruleContextAsset: { id: 'rule-asset' } as any,
  ruleContextAssetId: 'rule-asset',
  ruleDrawerOpen: true,
  ruleListScope: 'matched',
  ruleSearchKeyword: 'rule-keyword',
  setRuleContextAssetId: jest.fn(),
  setRuleDrawerOpen: jest.fn(),
  setRuleListScope: jest.fn(),
  setRuleSearchKeyword: jest.fn(),
  setSqlContextAssetId: jest.fn(),
  setSqlListMode: jest.fn(),
  setSqlSearchKeyword: jest.fn(),
  setSqlTemplateDrawerOpen: jest.fn(),
  sqlContextAsset: { id: 'sql-asset' } as any,
  sqlContextAssetId: 'sql-asset',
  sqlListMode: 'recent',
  sqlSearchKeyword: 'sql-keyword',
  sqlTemplateAssetOptions: [{ label: 'Orders', value: 'orders' }],
  sqlTemplateDrawerOpen: false,
  syncRuleDraftBaseline: jest.fn(),
  syncSqlDraftBaseline: jest.fn(),
  visibleRuleList: [{ id: 1 } as any],
  visibleSqlList: [{ id: 2 } as any],
});

const createEditorActions = (): KnowledgeWorkbenchEditorsActions => ({
  applyRuleContextDraft: jest.fn(),
  applySqlContextDraft: jest.fn(),
  handleCloseRuleDrawer: jest.fn(async () => true),
  handleCloseSqlTemplateDrawer: jest.fn(async () => true),
  handleCreateRuleFromAsset: jest.fn(async () => undefined),
  handleCreateSqlTemplateFromAsset: jest.fn(async () => undefined),
  handleDeleteRule: jest.fn(async () => undefined),
  handleDeleteSqlTemplate: jest.fn(async () => undefined),
  handleDuplicateRule: jest.fn(async () => undefined),
  handleDuplicateSqlTemplate: jest.fn(async () => undefined),
  handleResetRuleDetailEditor: jest.fn(),
  handleResetSqlTemplateEditor: jest.fn(),
  handleSubmitRuleDetail: jest.fn(async () => undefined),
  handleSubmitSqlTemplateDetail: jest.fn(async () => undefined),
  handleWorkbenchSectionChange: jest.fn(async () => undefined),
  openRuleEditor: jest.fn(async () => true),
  openSqlTemplateEditor: jest.fn(async () => true),
});

describe('knowledgeWorkbenchEditors composition helpers', () => {
  it('picks the draft-state input subset from the editors args', () => {
    const args = createArgs();

    expect(buildKnowledgeWorkbenchDraftStateInput(args)).toEqual({
      detailAssets: [],
      ruleForm: { form: 'rule' },
      ruleList: [],
      sqlList: [],
      sqlTemplateForm: { form: 'sql' },
    });
  });

  it('maps draft and route state into editor actions input', () => {
    const args = createArgs();
    const draftState = createDraftState();

    const result = buildKnowledgeWorkbenchEditorActionsInput({
      args,
      draftState,
    });

    expect(result).toMatchObject({
      activeWorkbenchSection: 'sqlTemplates',
      editingInstruction: args.editingInstruction,
      editingSqlPair: args.editingSqlPair,
      isRuleDraftDirty: true,
      isSqlDraftDirty: false,
      ruleContextAsset: draftState.ruleContextAsset,
      sqlContextAsset: draftState.sqlContextAsset,
      ruleDrawerOpen: true,
      sqlTemplateDrawerOpen: false,
      ruleForm: args.ruleForm,
      sqlTemplateForm: args.sqlTemplateForm,
      syncRuleDraftBaseline: draftState.syncRuleDraftBaseline,
      syncSqlDraftBaseline: draftState.syncSqlDraftBaseline,
    });
  });

  it('merges editor actions with draft-facing state for the hook result', () => {
    const draftState = createDraftState();
    const editorActions = createEditorActions();

    const result = buildKnowledgeWorkbenchEditorsResult({
      draftState,
      editorActions,
    });

    expect(result).toMatchObject({
      applyRuleContextDraft: editorActions.applyRuleContextDraft,
      applySqlContextDraft: editorActions.applySqlContextDraft,
      ruleContextAssetId: 'rule-asset',
      sqlContextAssetId: 'sql-asset',
      ruleListScope: 'matched',
      sqlListMode: 'recent',
      visibleRuleList: draftState.visibleRuleList,
      visibleSqlList: draftState.visibleSqlList,
    });
  });
});
