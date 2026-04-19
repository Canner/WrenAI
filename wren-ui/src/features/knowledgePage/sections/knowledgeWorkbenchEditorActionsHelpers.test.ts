import {
  buildKnowledgeWorkbenchRuleActionLaneInput,
  buildKnowledgeWorkbenchSaveShortcutInput,
  buildKnowledgeWorkbenchSectionChangeGuardInput,
  buildKnowledgeWorkbenchSqlActionLaneInput,
} from './buildKnowledgeWorkbenchEditorActionLaneInputs';
import { buildKnowledgeWorkbenchEditorActionsResult } from './buildKnowledgeWorkbenchEditorActionsResult';
import type { KnowledgeWorkbenchEditorActionsArgs } from './knowledgeWorkbenchEditorActionsTypes';

const baseArgs = (): KnowledgeWorkbenchEditorActionsArgs => ({
  activeWorkbenchSection: 'sqlTemplates',
  editingInstruction: { id: 2 } as any,
  editingSqlPair: { id: 1 } as any,
  isRuleDraftDirty: true,
  isSqlDraftDirty: false,
  onChangeWorkbenchSection: jest.fn(),
  onCreateRuleDraftFromAsset: jest.fn(),
  onCreateSqlTemplateDraftFromAsset: jest.fn(),
  onDeleteRule: jest.fn(),
  onDeleteSqlTemplate: jest.fn(),
  onOpenRuleDetail: jest.fn(),
  onOpenSqlTemplateDetail: jest.fn(),
  onResetRuleDetailEditor: jest.fn(),
  onResetSqlTemplateEditor: jest.fn(),
  onSubmitRuleDetail: jest.fn(async () => undefined),
  onSubmitSqlTemplateDetail: jest.fn(async () => undefined),
  ruleContextAsset: { id: 'rule-asset' } as any,
  ruleDrawerOpen: true,
  ruleForm: { setFieldsValue: jest.fn() },
  setRuleContextAssetId: jest.fn(),
  setRuleDrawerOpen: jest.fn(),
  setSqlContextAssetId: jest.fn(),
  setSqlTemplateDrawerOpen: jest.fn(),
  sqlContextAsset: { id: 'sql-asset' } as any,
  sqlTemplateDrawerOpen: false,
  sqlTemplateForm: { setFieldsValue: jest.fn() },
  syncRuleDraftBaseline: jest.fn(),
  syncSqlDraftBaseline: jest.fn(),
});

describe('knowledgeWorkbenchEditorActions composition helpers', () => {
  it('builds section change guard input from the shared editor action args', () => {
    const args = baseArgs();
    const runWithDirtyGuard = jest.fn(async () => true);

    expect(
      buildKnowledgeWorkbenchSectionChangeGuardInput({
        args: {
          activeWorkbenchSection: args.activeWorkbenchSection,
          isRuleDraftDirty: args.isRuleDraftDirty,
          isSqlDraftDirty: args.isSqlDraftDirty,
          onChangeWorkbenchSection: args.onChangeWorkbenchSection,
          setRuleDrawerOpen: args.setRuleDrawerOpen,
          setSqlTemplateDrawerOpen: args.setSqlTemplateDrawerOpen,
        },
        runWithDirtyGuard,
      }),
    ).toEqual({
      activeWorkbenchSection: 'sqlTemplates',
      isRuleDraftDirty: true,
      isSqlDraftDirty: false,
      onChangeWorkbenchSection: args.onChangeWorkbenchSection,
      runWithDirtyGuard,
      setRuleDrawerOpen: args.setRuleDrawerOpen,
      setSqlTemplateDrawerOpen: args.setSqlTemplateDrawerOpen,
    });
  });

  it('builds the sql action lane input with the expected sql-specific fields', () => {
    const args = baseArgs();
    const confirmDeleteEntry = jest.fn(async () => true);
    const runWithDirtyGuard = jest.fn(async () => true);

    expect(
      buildKnowledgeWorkbenchSqlActionLaneInput({
        args,
        confirmDeleteEntry,
        runWithDirtyGuard,
      }),
    ).toMatchObject({
      activeWorkbenchSection: 'sqlTemplates',
      editingSqlPair: { id: 1 },
      sqlTemplateForm: args.sqlTemplateForm,
      sqlTemplateDrawerOpen: false,
      sqlContextAsset: { id: 'sql-asset' },
      onDeleteSqlTemplate: args.onDeleteSqlTemplate,
      confirmDeleteEntry,
      runWithDirtyGuard,
    });
  });

  it('builds the rule action lane input with the expected rule-specific fields', () => {
    const args = baseArgs();
    const confirmDeleteEntry = jest.fn(async () => true);
    const runWithDirtyGuard = jest.fn(async () => true);

    expect(
      buildKnowledgeWorkbenchRuleActionLaneInput({
        args,
        confirmDeleteEntry,
        runWithDirtyGuard,
      }),
    ).toMatchObject({
      activeWorkbenchSection: 'sqlTemplates',
      editingInstruction: { id: 2 },
      ruleForm: args.ruleForm,
      ruleDrawerOpen: true,
      ruleContextAsset: { id: 'rule-asset' },
      onDeleteRule: args.onDeleteRule,
      confirmDeleteEntry,
      runWithDirtyGuard,
    });
  });

  it('builds save shortcut input from the lane submit handlers', () => {
    const args = baseArgs();
    const handleSubmitRuleDetail = jest.fn(async () => undefined);
    const handleSubmitSqlTemplateDetail = jest.fn(async () => undefined);

    expect(
      buildKnowledgeWorkbenchSaveShortcutInput({
        activeWorkbenchSection: args.activeWorkbenchSection,
        handleSubmitRuleDetail,
        handleSubmitSqlTemplateDetail,
        ruleDrawerOpen: args.ruleDrawerOpen,
        sqlTemplateDrawerOpen: args.sqlTemplateDrawerOpen,
      }),
    ).toEqual({
      activeWorkbenchSection: 'sqlTemplates',
      handleSubmitRuleDetail,
      handleSubmitSqlTemplateDetail,
      ruleDrawerOpen: true,
      sqlTemplateDrawerOpen: false,
    });
  });

  it('merges section change handlers with both rule and sql action lanes', () => {
    const handleWorkbenchSectionChange = jest.fn(async () => undefined);
    const ruleActions = {
      applyRuleContextDraft: jest.fn(),
      handleCloseRuleDrawer: jest.fn(async () => true),
      handleCreateRuleFromAsset: jest.fn(async () => undefined),
      handleDeleteRule: jest.fn(async () => undefined),
      handleDuplicateRule: jest.fn(async () => undefined),
      handleResetRuleDetailEditor: jest.fn(),
      handleSubmitRuleDetail: jest.fn(async () => undefined),
      openRuleEditor: jest.fn(async () => true),
    };
    const sqlActions = {
      applySqlContextDraft: jest.fn(),
      handleCloseSqlTemplateDrawer: jest.fn(async () => true),
      handleCreateSqlTemplateFromAsset: jest.fn(async () => undefined),
      handleDeleteSqlTemplate: jest.fn(async () => undefined),
      handleDuplicateSqlTemplate: jest.fn(async () => undefined),
      handleResetSqlTemplateEditor: jest.fn(),
      handleSubmitSqlTemplateDetail: jest.fn(async () => undefined),
      openSqlTemplateEditor: jest.fn(async () => true),
    };

    expect(
      buildKnowledgeWorkbenchEditorActionsResult({
        handleWorkbenchSectionChange,
        ruleActions,
        sqlActions,
      }),
    ).toMatchObject({
      handleWorkbenchSectionChange,
      applyRuleContextDraft: ruleActions.applyRuleContextDraft,
      openRuleEditor: ruleActions.openRuleEditor,
      applySqlContextDraft: sqlActions.applySqlContextDraft,
      openSqlTemplateEditor: sqlActions.openSqlTemplateEditor,
    });
  });
});
