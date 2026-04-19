import type { KnowledgeWorkbenchEditorOpenActionArgs } from './knowledgeWorkbenchEditorOpenActionTypes';
import type { KnowledgeWorkbenchAssetEditorActionsArgs } from './knowledgeWorkbenchAssetEditorActionsTypes';

export function buildKnowledgeWorkbenchAssetEditorOpenInput<
  TItem,
  TDraftValues extends Record<string, any>,
>({
  activeWorkbenchSection,
  targetSection,
  currentEditingId,
  drawerOpen,
  currentSectionDirty,
  counterpartSectionDirty,
  onChangeWorkbenchSection,
  onOpenDetail,
  form,
  syncDraftBaseline,
  setContextAssetId,
  setDrawerOpen,
  buildEditorValues,
  runWithDirtyGuard,
}: Pick<
  KnowledgeWorkbenchAssetEditorActionsArgs<TItem, TDraftValues>,
  | 'activeWorkbenchSection'
  | 'targetSection'
  | 'currentEditingId'
  | 'drawerOpen'
  | 'currentSectionDirty'
  | 'counterpartSectionDirty'
  | 'onChangeWorkbenchSection'
  | 'onOpenDetail'
  | 'form'
  | 'syncDraftBaseline'
  | 'setContextAssetId'
  | 'setDrawerOpen'
  | 'buildEditorValues'
  | 'runWithDirtyGuard'
>): KnowledgeWorkbenchEditorOpenActionArgs<TItem, TDraftValues> {
  return {
    activeWorkbenchSection,
    targetSection,
    currentEditingId,
    drawerOpen,
    currentSectionDirty,
    counterpartSectionDirty,
    onChangeWorkbenchSection,
    onOpenDetail,
    form,
    syncDraftBaseline,
    setContextAssetId,
    setDrawerOpen,
    buildEditorValues,
    runWithDirtyGuard,
  };
}
