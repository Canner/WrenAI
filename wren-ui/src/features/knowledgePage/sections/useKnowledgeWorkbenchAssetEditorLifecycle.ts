import { useCallback } from 'react';
import { message } from 'antd';
import type { AssetView } from '@/features/knowledgePage/types';

export function useKnowledgeWorkbenchAssetEditorLifecycle({
  applySuccessMessage,
  buildDraftFromAsset,
  contextAsset,
  emptyValues,
  form,
  isDraftDirty,
  onResetEditor,
  onSubmitDetail,
  runWithDirtyGuard,
  setContextAssetId,
  setDrawerOpen,
  syncDraftBaseline,
}: {
  applySuccessMessage: string;
  buildDraftFromAsset: (asset: AssetView) => Record<string, any>;
  contextAsset?: AssetView | null;
  emptyValues: Record<string, any>;
  form: {
    setFieldsValue: (values: Record<string, any>) => void;
  };
  isDraftDirty: boolean;
  onResetEditor: () => void;
  onSubmitDetail: () => Promise<void> | void;
  runWithDirtyGuard: (
    dirty: boolean,
    action: () => void | Promise<void>,
  ) => Promise<boolean>;
  setContextAssetId: (value?: string) => void;
  setDrawerOpen: (open: boolean) => void;
  syncDraftBaseline: (values?: Record<string, any>) => void;
}) {
  const handleResetEditor = useCallback(() => {
    onResetEditor();
    syncDraftBaseline(emptyValues);
  }, [emptyValues, onResetEditor, syncDraftBaseline]);

  const clearActiveEditorDraft = useCallback(() => {
    handleResetEditor();
    setContextAssetId(undefined);
    setDrawerOpen(false);
  }, [handleResetEditor, setContextAssetId, setDrawerOpen]);

  const handleSubmitDetail = useCallback(async () => {
    await onSubmitDetail();
    syncDraftBaseline();
  }, [onSubmitDetail, syncDraftBaseline]);

  const handleCloseDrawer = useCallback(async () => {
    const closed = await runWithDirtyGuard(
      isDraftDirty,
      clearActiveEditorDraft,
    );

    return closed;
  }, [clearActiveEditorDraft, isDraftDirty, runWithDirtyGuard]);

  const applyContextDraft = useCallback(() => {
    if (!contextAsset) {
      return;
    }
    form.setFieldsValue(buildDraftFromAsset(contextAsset));
    message.success(applySuccessMessage);
  }, [applySuccessMessage, buildDraftFromAsset, contextAsset, form]);

  return {
    applyContextDraft,
    clearActiveEditorDraft,
    handleCloseDrawer,
    handleResetEditor,
    handleSubmitDetail,
  };
}
