import type { KnowledgeWorkbenchAssetEditorActionsArgs } from './knowledgeWorkbenchAssetEditorActionsTypes';

export function buildKnowledgeWorkbenchAssetEditorLifecycleInput<
  TItem,
  TDraftValues extends Record<string, any>,
>({
  applySuccessMessage,
  buildDraftFromAsset,
  contextAsset,
  emptyValues,
  form,
  currentSectionDirty,
  onResetEditor,
  onSubmitDetail,
  runWithDirtyGuard,
  setContextAssetId,
  setDrawerOpen,
  syncDraftBaseline,
}: Pick<
  KnowledgeWorkbenchAssetEditorActionsArgs<TItem, TDraftValues>,
  | 'applySuccessMessage'
  | 'buildDraftFromAsset'
  | 'contextAsset'
  | 'emptyValues'
  | 'form'
  | 'currentSectionDirty'
  | 'onResetEditor'
  | 'onSubmitDetail'
  | 'runWithDirtyGuard'
  | 'setContextAssetId'
  | 'setDrawerOpen'
  | 'syncDraftBaseline'
>) {
  return {
    applySuccessMessage,
    buildDraftFromAsset,
    contextAsset,
    emptyValues,
    form,
    isDraftDirty: currentSectionDirty,
    onResetEditor,
    onSubmitDetail,
    runWithDirtyGuard,
    setContextAssetId,
    setDrawerOpen,
    syncDraftBaseline,
  };
}
