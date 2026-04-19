import type {
  KnowledgeWorkbenchEditorsArgs,
  KnowledgeWorkbenchEditorsDraftState,
} from './knowledgeWorkbenchEditorsTypes';

export function buildKnowledgeWorkbenchEditorActionsInput({
  args,
  draftState,
}: {
  args: KnowledgeWorkbenchEditorsArgs;
  draftState: KnowledgeWorkbenchEditorsDraftState;
}) {
  return {
    activeWorkbenchSection: args.activeWorkbenchSection,
    editingInstruction: args.editingInstruction,
    editingSqlPair: args.editingSqlPair,
    isRuleDraftDirty: draftState.isRuleDraftDirty,
    isSqlDraftDirty: draftState.isSqlDraftDirty,
    onChangeWorkbenchSection: args.onChangeWorkbenchSection,
    onCreateRuleDraftFromAsset: args.onCreateRuleDraftFromAsset,
    onCreateSqlTemplateDraftFromAsset: args.onCreateSqlTemplateDraftFromAsset,
    onDeleteRule: args.onDeleteRule,
    onDeleteSqlTemplate: args.onDeleteSqlTemplate,
    onOpenRuleDetail: args.onOpenRuleDetail,
    onOpenSqlTemplateDetail: args.onOpenSqlTemplateDetail,
    onResetRuleDetailEditor: args.onResetRuleDetailEditor,
    onResetSqlTemplateEditor: args.onResetSqlTemplateEditor,
    onSubmitRuleDetail: args.onSubmitRuleDetail,
    onSubmitSqlTemplateDetail: args.onSubmitSqlTemplateDetail,
    ruleContextAsset: draftState.ruleContextAsset,
    setRuleDrawerOpen: draftState.setRuleDrawerOpen,
    ruleDrawerOpen: draftState.ruleDrawerOpen,
    ruleForm: args.ruleForm,
    setRuleContextAssetId: draftState.setRuleContextAssetId,
    setSqlContextAssetId: draftState.setSqlContextAssetId,
    setSqlTemplateDrawerOpen: draftState.setSqlTemplateDrawerOpen,
    sqlTemplateDrawerOpen: draftState.sqlTemplateDrawerOpen,
    sqlContextAsset: draftState.sqlContextAsset,
    sqlTemplateForm: args.sqlTemplateForm,
    syncRuleDraftBaseline: draftState.syncRuleDraftBaseline,
    syncSqlDraftBaseline: draftState.syncSqlDraftBaseline,
  };
}
