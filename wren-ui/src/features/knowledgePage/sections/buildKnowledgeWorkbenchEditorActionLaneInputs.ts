import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';
import type {
  KnowledgeWorkbenchDeleteConfirm,
  KnowledgeWorkbenchDirtyGuardRunner,
  KnowledgeWorkbenchEditorActionsArgs,
  KnowledgeWorkbenchSectionChangeGuardArgs,
} from './knowledgeWorkbenchEditorActionsTypes';

export function buildKnowledgeWorkbenchSectionChangeGuardInput({
  args,
  runWithDirtyGuard,
}: {
  args: KnowledgeWorkbenchSectionChangeGuardArgs;
  runWithDirtyGuard: KnowledgeWorkbenchDirtyGuardRunner;
}) {
  return {
    activeWorkbenchSection: args.activeWorkbenchSection,
    isRuleDraftDirty: args.isRuleDraftDirty,
    isSqlDraftDirty: args.isSqlDraftDirty,
    onChangeWorkbenchSection: args.onChangeWorkbenchSection,
    runWithDirtyGuard,
    setRuleDrawerOpen: args.setRuleDrawerOpen,
    setSqlTemplateDrawerOpen: args.setSqlTemplateDrawerOpen,
  };
}

export function buildKnowledgeWorkbenchSqlActionLaneInput({
  args,
  confirmDeleteEntry,
  runWithDirtyGuard,
}: {
  args: KnowledgeWorkbenchEditorActionsArgs;
  confirmDeleteEntry: KnowledgeWorkbenchDeleteConfirm;
  runWithDirtyGuard: KnowledgeWorkbenchDirtyGuardRunner;
}) {
  return {
    activeWorkbenchSection: args.activeWorkbenchSection,
    editingSqlPair: args.editingSqlPair,
    isRuleDraftDirty: args.isRuleDraftDirty,
    isSqlDraftDirty: args.isSqlDraftDirty,
    onChangeWorkbenchSection: args.onChangeWorkbenchSection,
    onCreateSqlTemplateDraftFromAsset: args.onCreateSqlTemplateDraftFromAsset,
    onDeleteSqlTemplate: args.onDeleteSqlTemplate,
    onOpenSqlTemplateDetail: args.onOpenSqlTemplateDetail,
    onResetSqlTemplateEditor: args.onResetSqlTemplateEditor,
    onSubmitSqlTemplateDetail: args.onSubmitSqlTemplateDetail,
    sqlTemplateForm: args.sqlTemplateForm,
    sqlTemplateDrawerOpen: args.sqlTemplateDrawerOpen,
    syncSqlDraftBaseline: args.syncSqlDraftBaseline,
    setSqlContextAssetId: args.setSqlContextAssetId,
    setSqlTemplateDrawerOpen: args.setSqlTemplateDrawerOpen,
    sqlContextAsset: args.sqlContextAsset,
    runWithDirtyGuard,
    confirmDeleteEntry,
  };
}

export function buildKnowledgeWorkbenchRuleActionLaneInput({
  args,
  confirmDeleteEntry,
  runWithDirtyGuard,
}: {
  args: KnowledgeWorkbenchEditorActionsArgs;
  confirmDeleteEntry: KnowledgeWorkbenchDeleteConfirm;
  runWithDirtyGuard: KnowledgeWorkbenchDirtyGuardRunner;
}) {
  return {
    activeWorkbenchSection: args.activeWorkbenchSection,
    editingInstruction: args.editingInstruction,
    isRuleDraftDirty: args.isRuleDraftDirty,
    isSqlDraftDirty: args.isSqlDraftDirty,
    onChangeWorkbenchSection: args.onChangeWorkbenchSection,
    onCreateRuleDraftFromAsset: args.onCreateRuleDraftFromAsset,
    onDeleteRule: args.onDeleteRule,
    onOpenRuleDetail: args.onOpenRuleDetail,
    onResetRuleDetailEditor: args.onResetRuleDetailEditor,
    onSubmitRuleDetail: args.onSubmitRuleDetail,
    ruleDrawerOpen: args.ruleDrawerOpen,
    ruleForm: args.ruleForm,
    syncRuleDraftBaseline: args.syncRuleDraftBaseline,
    setRuleContextAssetId: args.setRuleContextAssetId,
    setRuleDrawerOpen: args.setRuleDrawerOpen,
    ruleContextAsset: args.ruleContextAsset,
    runWithDirtyGuard,
    confirmDeleteEntry,
  };
}

export function buildKnowledgeWorkbenchSaveShortcutInput({
  activeWorkbenchSection,
  handleSubmitRuleDetail,
  handleSubmitSqlTemplateDetail,
  ruleDrawerOpen,
  sqlTemplateDrawerOpen,
}: {
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  handleSubmitRuleDetail: () => Promise<void>;
  handleSubmitSqlTemplateDetail: () => Promise<void>;
  ruleDrawerOpen: boolean;
  sqlTemplateDrawerOpen: boolean;
}) {
  return {
    activeWorkbenchSection,
    handleSubmitRuleDetail,
    handleSubmitSqlTemplateDetail,
    ruleDrawerOpen,
    sqlTemplateDrawerOpen,
  };
}
