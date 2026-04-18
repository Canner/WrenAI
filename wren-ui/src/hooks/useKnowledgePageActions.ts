import { useCallback } from 'react';
import { message } from 'antd';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { Path } from '@/utils/enum';

type KnowledgeBaseForActions = {
  id: string;
  workspaceId: string;
  defaultKbSnapshot?: {
    id: string;
    deployHash: string;
  } | null;
};

export const resolveKnowledgeRuntimeSelector = ({
  knowledgeBase,
  fallbackSelector,
}: {
  knowledgeBase?: KnowledgeBaseForActions | null;
  fallbackSelector: ClientRuntimeScopeSelector;
}): ClientRuntimeScopeSelector => {
  if (!knowledgeBase) {
    return fallbackSelector;
  }

  return {
    workspaceId: knowledgeBase.workspaceId,
    knowledgeBaseId: knowledgeBase.id,
    ...(knowledgeBase.defaultKbSnapshot?.id
      ? { kbSnapshotId: knowledgeBase.defaultKbSnapshot.id }
      : {}),
    ...(knowledgeBase.defaultKbSnapshot?.deployHash
      ? { deployHash: knowledgeBase.defaultKbSnapshot.deployHash }
      : {}),
  };
};

export const buildKnowledgeSwitchPath = (
  knowledgeBase: KnowledgeBaseForActions,
) => {
  const nextSearchParams = new URLSearchParams({
    workspaceId: knowledgeBase.workspaceId,
    knowledgeBaseId: knowledgeBase.id,
    kbSnapshotId: knowledgeBase.defaultKbSnapshot?.id || '',
    deployHash: knowledgeBase.defaultKbSnapshot?.deployHash || '',
  });
  return `${Path.Knowledge}?${nextSearchParams.toString()}`;
};

export default function useKnowledgePageActions({
  activeKnowledgeBase,
  runtimeNavigationSelector,
  buildRuntimeScopeUrl,
  pushRoute,
  isKnowledgeMutationDisabled,
  isSnapshotReadonlyKnowledgeBase,
  snapshotReadonlyHint,
  openModalSafely,
  setAssetModalOpen,
  setAssetWizardStep,
  resetAssetDraft,
}: {
  activeKnowledgeBase?: KnowledgeBaseForActions | null;
  runtimeNavigationSelector: ClientRuntimeScopeSelector;
  buildRuntimeScopeUrl: (
    path: string,
    query?: Record<string, string | number | undefined>,
    selector?: ClientRuntimeScopeSelector,
  ) => string;
  pushRoute: (url: string) => Promise<unknown>;
  isKnowledgeMutationDisabled: boolean;
  isSnapshotReadonlyKnowledgeBase: boolean;
  snapshotReadonlyHint: string;
  openModalSafely: (action: () => void) => void;
  setAssetModalOpen: (open: boolean) => void;
  setAssetWizardStep: (step: number) => void;
  resetAssetDraft: () => void;
}) {
  const closeAssetModal = useCallback(() => {
    setAssetModalOpen(false);
    setAssetWizardStep(0);
    resetAssetDraft();
  }, [resetAssetDraft, setAssetModalOpen, setAssetWizardStep]);

  const buildKnowledgeRuntimeSelector = useCallback(
    (knowledgeBase?: KnowledgeBaseForActions | null) =>
      resolveKnowledgeRuntimeSelector({
        knowledgeBase,
        fallbackSelector: runtimeNavigationSelector,
      }),
    [runtimeNavigationSelector],
  );

  const openConnectorConsole = useCallback(async () => {
    closeAssetModal();
    const nextUrl = buildRuntimeScopeUrl(
      Path.SettingsConnectors,
      {},
      buildKnowledgeRuntimeSelector(activeKnowledgeBase),
    );
    await pushRoute(nextUrl);
  }, [
    activeKnowledgeBase,
    buildKnowledgeRuntimeSelector,
    buildRuntimeScopeUrl,
    closeAssetModal,
    pushRoute,
  ]);

  const openAssetWizard = useCallback(
    (onAllowed?: () => void) => {
      if (isKnowledgeMutationDisabled) {
        if (isSnapshotReadonlyKnowledgeBase) {
          message.info(snapshotReadonlyHint);
          return;
        }

        message.info('系统样例知识库不支持接入新资产');
        return;
      }

      if (onAllowed) {
        onAllowed();
        return;
      }

      openModalSafely(() => {
        setAssetWizardStep(0);
        setAssetModalOpen(true);
      });
    },
    [
      isKnowledgeMutationDisabled,
      isSnapshotReadonlyKnowledgeBase,
      openModalSafely,
      setAssetModalOpen,
      setAssetWizardStep,
      snapshotReadonlyHint,
    ],
  );

  const buildKnowledgeSwitchUrl = useCallback(
    (knowledgeBase: KnowledgeBaseForActions) =>
      buildRuntimeScopeUrl(
        Path.Knowledge,
        {},
        buildKnowledgeRuntimeSelector(knowledgeBase),
      ),
    [buildKnowledgeRuntimeSelector, buildRuntimeScopeUrl],
  );

  return {
    closeAssetModal,
    buildKnowledgeRuntimeSelector,
    openConnectorConsole,
    openAssetWizard,
    buildKnowledgeSwitchUrl,
  };
}
