import { useCallback } from 'react';
import { message } from 'antd';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { Path } from '@/utils/enum';
import {
  buildKnowledgeWorkbenchUrl,
  resolveKnowledgeWorkbenchRuntimeSelector,
  type KnowledgeWorkbenchRouteKnowledgeBase,
} from '@/utils/knowledgeWorkbench';

type KnowledgeBaseForActions = KnowledgeWorkbenchRouteKnowledgeBase;

export const resolveKnowledgeRuntimeSelector =
  resolveKnowledgeWorkbenchRuntimeSelector;

export const buildKnowledgeSwitchPath = (
  knowledgeBase: KnowledgeBaseForActions,
) => {
  const selector = resolveKnowledgeWorkbenchRuntimeSelector({
    knowledgeBase,
    fallbackSelector: { workspaceId: knowledgeBase.workspaceId },
  });
  const nextSearchParams = new URLSearchParams();

  if (selector.workspaceId) {
    nextSearchParams.set('workspaceId', selector.workspaceId);
  }
  if (selector.knowledgeBaseId) {
    nextSearchParams.set('knowledgeBaseId', selector.knowledgeBaseId);
  }
  if (selector.kbSnapshotId) {
    nextSearchParams.set('kbSnapshotId', selector.kbSnapshotId);
  }
  if (selector.deployHash) {
    nextSearchParams.set('deployHash', selector.deployHash);
  }

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
    query?: Record<string, string | number | boolean | null | undefined>,
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
      resolveKnowledgeWorkbenchRuntimeSelector({
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
      buildKnowledgeWorkbenchUrl({
        buildRuntimeScopeUrl,
        knowledgeBase,
        fallbackSelector: runtimeNavigationSelector,
      }),
    [buildRuntimeScopeUrl, runtimeNavigationSelector],
  );

  return {
    closeAssetModal,
    buildKnowledgeRuntimeSelector,
    openConnectorConsole,
    openAssetWizard,
    buildKnowledgeSwitchUrl,
  };
}
