import { useCallback } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import type { AssetView } from '@/features/knowledgePage/types';
import {
  runKnowledgeWorkbenchCreateDraftFromAsset,
  runKnowledgeWorkbenchDeleteEntry,
  runKnowledgeWorkbenchDuplicateEntry,
} from './runKnowledgeWorkbenchEditorEntryEffects';
import type { KnowledgeWorkbenchEditorEntryActionsArgs } from './knowledgeWorkbenchEditorEntryActionTypes';

export function useKnowledgeWorkbenchEditorEntryActions<
  TItem,
  TDraftValues extends Record<string, any>,
>({
  buildDraftFromAsset,
  buildDuplicateDraft,
  clearActiveEditorDraft,
  confirmDeleteEntry,
  createFromAssetSuccessMessage,
  duplicateSuccessMessage,
  editingItemId,
  entityLabel,
  getItemId,
  onCreateDraftFromAsset,
  onDeleteItem,
  openEditor,
}: KnowledgeWorkbenchEditorEntryActionsArgs<TItem, TDraftValues>) {
  const handleCreateFromAsset = useCallback(
    async (asset: AssetView) => {
      await runKnowledgeWorkbenchCreateDraftFromAsset({
        asset,
        buildDraftFromAsset,
        createFromAssetSuccessMessage,
        onCreateDraftFromAsset,
        openEditor,
        showSuccess: message.success,
      });
    },
    [
      buildDraftFromAsset,
      createFromAssetSuccessMessage,
      onCreateDraftFromAsset,
      openEditor,
    ],
  );

  const handleDuplicateItem = useCallback(
    async (item: TItem) => {
      await runKnowledgeWorkbenchDuplicateEntry({
        item,
        buildDuplicateDraft,
        duplicateSuccessMessage,
        openEditor,
        showSuccess: message.success,
      });
    },
    [buildDuplicateDraft, duplicateSuccessMessage, openEditor],
  );

  const handleDeleteItem = useCallback(
    async (item: TItem) => {
      await runKnowledgeWorkbenchDeleteEntry({
        item,
        clearActiveEditorDraft,
        confirmDeleteEntry,
        editingItemId,
        entityLabel,
        getItemId,
        onDeleteItem,
      });
    },
    [
      clearActiveEditorDraft,
      confirmDeleteEntry,
      editingItemId,
      entityLabel,
      getItemId,
      onDeleteItem,
    ],
  );

  return {
    handleCreateFromAsset,
    handleDeleteItem,
    handleDuplicateItem,
  };
}
