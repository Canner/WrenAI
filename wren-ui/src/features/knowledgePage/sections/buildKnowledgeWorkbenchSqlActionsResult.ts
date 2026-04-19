import type {
  KnowledgeWorkbenchSqlActionCore,
  KnowledgeWorkbenchSqlOpenEditorParams,
} from './knowledgeWorkbenchSqlAssetEditorActionTypes';

export function buildKnowledgeWorkbenchSqlActionsResult({
  applyContextDraft,
  handleCloseDrawer,
  handleCreateFromAsset,
  handleDeleteItem,
  handleDuplicateItem,
  handleResetEditor,
  handleSubmitDetail,
  openSqlTemplateEditor,
}: KnowledgeWorkbenchSqlActionCore & {
  openSqlTemplateEditor: (
    params: KnowledgeWorkbenchSqlOpenEditorParams,
  ) => Promise<boolean>;
}) {
  return {
    applySqlContextDraft: applyContextDraft,
    handleCloseSqlTemplateDrawer: handleCloseDrawer,
    handleCreateSqlTemplateFromAsset: handleCreateFromAsset,
    handleDeleteSqlTemplate: handleDeleteItem,
    handleDuplicateSqlTemplate: handleDuplicateItem,
    handleResetSqlTemplateEditor: handleResetEditor,
    handleSubmitSqlTemplateDetail: handleSubmitDetail,
    openSqlTemplateEditor,
  };
}
