import {
  canShowKnowledgeLifecycleAction,
  getKnowledgeLifecycleActionLabel,
  resolveKnowledgeNavBadgeCount,
  resolveVisibleKnowledgeBaseId,
  shouldCommitPendingKnowledgeBaseSwitch,
  shouldRouteSwitchKnowledgeBase,
  shouldShowKnowledgeAssetsLoading,
} from '@/hooks/useKnowledgePageHelpers';
import { shouldSyncKnowledgeRuntimeScopeData } from '@/hooks/useKnowledgeRuntimeSync';
import KnowledgeWorkbenchPageFrame from '@/features/knowledgePage/KnowledgeWorkbenchPageFrame';
import useKnowledgeWorkbenchPageController from '@/features/knowledgePage/useKnowledgeWorkbenchPageController';

export {
  canShowKnowledgeLifecycleAction,
  getKnowledgeLifecycleActionLabel,
  resolveKnowledgeNavBadgeCount,
  resolveVisibleKnowledgeBaseId,
  shouldCommitPendingKnowledgeBaseSwitch,
  shouldRouteSwitchKnowledgeBase,
  shouldShowKnowledgeAssetsLoading,
  shouldSyncKnowledgeRuntimeScopeData,
};

export default function KnowledgeHomePage() {
  const { loading, sidebarProps, mainStageProps, overlaysProps } =
    useKnowledgeWorkbenchPageController();

  return (
    <KnowledgeWorkbenchPageFrame
      loading={loading}
      sidebarProps={sidebarProps}
      mainStageProps={mainStageProps}
      overlaysProps={overlaysProps}
    />
  );
}
