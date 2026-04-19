import type {
  KnowledgeWorkbenchRuleActionCore,
  KnowledgeWorkbenchRuleOpenEditorParams,
} from './knowledgeWorkbenchRuleAssetEditorActionTypes';

export function buildKnowledgeWorkbenchRuleActionsResult({
  applyContextDraft,
  handleCloseDrawer,
  handleCreateFromAsset,
  handleDeleteItem,
  handleDuplicateItem,
  handleResetEditor,
  handleSubmitDetail,
  openRuleEditor,
}: KnowledgeWorkbenchRuleActionCore & {
  openRuleEditor: (
    params: KnowledgeWorkbenchRuleOpenEditorParams,
  ) => Promise<boolean>;
}) {
  return {
    applyRuleContextDraft: applyContextDraft,
    handleCloseRuleDrawer: handleCloseDrawer,
    handleCreateRuleFromAsset: handleCreateFromAsset,
    handleDeleteRule: handleDeleteItem,
    handleDuplicateRule: handleDuplicateItem,
    handleResetRuleDetailEditor: handleResetEditor,
    handleSubmitRuleDetail: handleSubmitDetail,
    openRuleEditor,
  };
}
