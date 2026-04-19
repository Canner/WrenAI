import type { KnowledgeWorkbenchAssetEditorActionsResult } from './knowledgeWorkbenchAssetEditorActionsTypes';

export function buildKnowledgeWorkbenchAssetEditorActionsResult<
  TItem,
  TDraftValues extends Record<string, any>,
>({
  applyContextDraft,
  contextAssetId,
  handleCloseDrawer,
  handleCreateFromAsset,
  handleDeleteItem,
  handleDuplicateItem,
  handleResetEditor,
  handleSubmitDetail,
  openEditor,
}: KnowledgeWorkbenchAssetEditorActionsResult<TItem, TDraftValues>) {
  return {
    applyContextDraft,
    contextAssetId,
    handleCloseDrawer,
    handleCreateFromAsset,
    handleDeleteItem,
    handleDuplicateItem,
    handleResetEditor,
    handleSubmitDetail,
    openEditor,
  };
}
