import { useCallback } from 'react';
import { buildKnowledgeWorkbenchEditorOpenPlan } from './buildKnowledgeWorkbenchEditorOpenPlan';
import { runKnowledgeWorkbenchEditorOpenEffects } from './runKnowledgeWorkbenchEditorOpenEffects';
import type {
  KnowledgeWorkbenchEditorOpenActionArgs,
  KnowledgeWorkbenchEditorOpenActionParams,
} from './knowledgeWorkbenchEditorOpenActionTypes';

export function useKnowledgeWorkbenchEditorOpenAction<
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
}: KnowledgeWorkbenchEditorOpenActionArgs<TItem, TDraftValues>) {
  return useCallback(
    async ({
      item,
      draftValues,
      contextAssetId,
      switchSection = true,
    }: KnowledgeWorkbenchEditorOpenActionParams<TItem, TDraftValues>) => {
      const { dirtyBeforeOpen, shouldOnlyEnsureDrawerOpen } =
        buildKnowledgeWorkbenchEditorOpenPlan({
          activeWorkbenchSection,
          targetSection,
          currentEditingId: currentEditingId || null,
          nextEditingId:
            (item as { id?: string | number } | undefined)?.id || null,
          hasDraftValues: Boolean(draftValues),
          drawerOpen,
          currentSectionDirty,
          counterpartSectionDirty,
          switchSection,
        });

      if (shouldOnlyEnsureDrawerOpen) {
        setDrawerOpen(true);
        return true;
      }

      return runWithDirtyGuard(dirtyBeforeOpen, async () => {
        await runKnowledgeWorkbenchEditorOpenEffects({
          activeWorkbenchSection,
          targetSection,
          onChangeWorkbenchSection,
          onOpenDetail,
          form,
          syncDraftBaseline,
          setContextAssetId,
          setDrawerOpen,
          buildEditorValues,
          item,
          draftValues,
          contextAssetId,
          switchSection,
        });
      });
    },
    [
      activeWorkbenchSection,
      buildEditorValues,
      counterpartSectionDirty,
      currentEditingId,
      currentSectionDirty,
      drawerOpen,
      form,
      onChangeWorkbenchSection,
      onOpenDetail,
      runWithDirtyGuard,
      setContextAssetId,
      setDrawerOpen,
      syncDraftBaseline,
      targetSection,
    ],
  );
}
