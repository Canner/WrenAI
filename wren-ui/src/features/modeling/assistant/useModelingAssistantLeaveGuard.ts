import { useCallback } from 'react';
import { appModal } from '@/utils/antdAppBridge';

const DEFAULT_TITLE = 'Go back to the modeling page?';
const DEFAULT_DESCRIPTION =
  'Please be aware that leaving the page will not save your progress, and this action cannot be undone.';

export default function useModelingAssistantLeaveGuard({
  onLeave,
}: {
  onLeave: () => void | Promise<void>;
}) {
  const confirmLeave = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        appModal.confirm({
          title: DEFAULT_TITLE,
          content: DEFAULT_DESCRIPTION,
          okText: 'Go back',
          cancelText: 'Cancel',
          onOk: async () => {
            await onLeave();
            resolve(true);
          },
          onCancel: () => resolve(false),
        });
      }),
    [onLeave],
  );

  const onBackClick = useCallback(() => {
    void confirmLeave();
  }, [confirmLeave]);

  return {
    confirmLeave,
    onBackClick,
  };
}
