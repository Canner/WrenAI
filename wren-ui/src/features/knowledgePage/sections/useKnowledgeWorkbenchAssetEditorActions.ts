import { buildKnowledgeWorkbenchAssetEditorLifecycleInput } from './buildKnowledgeWorkbenchAssetEditorLifecycleInput';
import { buildKnowledgeWorkbenchAssetEditorOpenInput } from './buildKnowledgeWorkbenchAssetEditorOpenInput';
import { buildKnowledgeWorkbenchEditorEntryActionsInput } from './buildKnowledgeWorkbenchEditorEntryActionsInput';
import { buildKnowledgeWorkbenchAssetEditorActionsResult } from './buildKnowledgeWorkbenchAssetEditorActionsResult';
import type { KnowledgeWorkbenchAssetEditorActionsArgs } from './knowledgeWorkbenchAssetEditorActionsTypes';
import { useKnowledgeWorkbenchAssetEditorLifecycle } from './useKnowledgeWorkbenchAssetEditorLifecycle';
import { useKnowledgeWorkbenchEditorEntryActions } from './useKnowledgeWorkbenchEditorEntryActions';
import { useKnowledgeWorkbenchEditorOpenAction } from './useKnowledgeWorkbenchEditorOpenAction';

export function useKnowledgeWorkbenchAssetEditorActions<
  TItem,
  TDraftValues extends Record<string, any>,
>(args: KnowledgeWorkbenchAssetEditorActionsArgs<TItem, TDraftValues>) {
  const {
    applyContextDraft,
    clearActiveEditorDraft,
    handleCloseDrawer,
    handleResetEditor,
    handleSubmitDetail: submitDetail,
  } = useKnowledgeWorkbenchAssetEditorLifecycle(
    buildKnowledgeWorkbenchAssetEditorLifecycleInput(args),
  );

  const openEditor = useKnowledgeWorkbenchEditorOpenAction<TItem, TDraftValues>(
    buildKnowledgeWorkbenchAssetEditorOpenInput(args),
  );

  const { handleCreateFromAsset, handleDeleteItem, handleDuplicateItem } =
    useKnowledgeWorkbenchEditorEntryActions<TItem, TDraftValues>(
      buildKnowledgeWorkbenchEditorEntryActionsInput({
        ...args,
        clearActiveEditorDraft,
        openEditor,
      }),
    );

  return buildKnowledgeWorkbenchAssetEditorActionsResult({
    applyContextDraft,
    contextAssetId: args.contextAssetId,
    handleCloseDrawer,
    handleCreateFromAsset,
    handleDeleteItem,
    handleDuplicateItem,
    handleResetEditor,
    handleSubmitDetail: submitDetail,
    openEditor,
  });
}
