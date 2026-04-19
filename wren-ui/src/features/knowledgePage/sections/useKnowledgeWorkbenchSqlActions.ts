import { useCallback } from 'react';
import {
  buildKnowledgeWorkbenchSqlActionsResult,
  buildKnowledgeWorkbenchSqlAssetEditorActionsInput,
  buildKnowledgeWorkbenchSqlOpenEditorInput,
  type KnowledgeWorkbenchSqlActionsArgs,
  type SqlDraftValues,
} from './knowledgeWorkbenchAssetEditorActionConfigs';
import { useKnowledgeWorkbenchAssetEditorActions } from './useKnowledgeWorkbenchAssetEditorActions';
import { SqlPair } from '@/types/knowledge';

export function useKnowledgeWorkbenchSqlActions(
  args: KnowledgeWorkbenchSqlActionsArgs,
) {
  const {
    applyContextDraft,
    handleCloseDrawer,
    handleCreateFromAsset,
    handleDeleteItem,
    handleDuplicateItem,
    handleResetEditor,
    handleSubmitDetail,
    openEditor,
  } = useKnowledgeWorkbenchAssetEditorActions<SqlPair, SqlDraftValues>(
    buildKnowledgeWorkbenchSqlAssetEditorActionsInput(args),
  );

  const openSqlTemplateEditor = useCallback(
    (params: {
      sqlPair?: SqlPair;
      draftValues?: SqlDraftValues;
      contextAssetId?: string;
      switchSection?: boolean;
    }) => openEditor(buildKnowledgeWorkbenchSqlOpenEditorInput(params)),
    [openEditor],
  );

  return buildKnowledgeWorkbenchSqlActionsResult({
    applyContextDraft,
    handleCloseDrawer,
    handleCreateFromAsset,
    handleDeleteItem,
    handleDuplicateItem,
    handleResetEditor,
    handleSubmitDetail,
    openSqlTemplateEditor,
  });
}
