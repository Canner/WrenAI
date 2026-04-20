import { useCallback } from 'react';
import { appModal } from '@/utils/antdAppBridge';

export function useKnowledgeWorkbenchDirtyGuards() {
  const confirmDiscardUnsavedChanges = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        appModal.confirm({
          title: '当前编辑尚未保存',
          content: '继续切换会丢失本次改动，确定继续吗？',
          okText: '继续切换',
          cancelText: '留在当前',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      }),
    [],
  );

  const confirmDeleteEntry = useCallback(
    (entityLabel: string) =>
      new Promise<boolean>((resolve) => {
        appModal.confirm({
          title: `删除${entityLabel}`,
          content: `删除后不可恢复，确定要删除这条${entityLabel}吗？`,
          okText: '确认删除',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      }),
    [],
  );

  const runWithDirtyGuard = useCallback(
    async (dirty: boolean, action: () => void | Promise<void>) => {
      if (dirty) {
        const confirmed = await confirmDiscardUnsavedChanges();
        if (!confirmed) {
          return false;
        }
      }

      await action();
      return true;
    },
    [confirmDiscardUnsavedChanges],
  );

  return {
    confirmDeleteEntry,
    runWithDirtyGuard,
  };
}
