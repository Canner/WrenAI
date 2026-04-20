import useKnowledgeActiveKnowledgeBaseSwitch from '@/hooks/useKnowledgeActiveKnowledgeBaseSwitch';
import { shouldCommitPendingKnowledgeBaseSwitch } from '@/hooks/useKnowledgePageHelpers';
import useKnowledgePendingSwitchSync from '@/hooks/useKnowledgePendingSwitchSync';
import useKnowledgeSwitchReset from '@/hooks/useKnowledgeSwitchReset';
import useKnowledgeWorkbenchBootstrap from './useKnowledgeWorkbenchBootstrap';
import type { AssetView, SelectedAssetTableValue } from './types';

export function useKnowledgeWorkbenchSyncEffects({
  activeKnowledgeBaseId,
  activeKnowledgeSnapshotId,
  currentKnowledgeBaseId,
  hasRuntimeScope,
  loadRuleList,
  loadSqlList,
  pendingKnowledgeBaseId,
  refetchReady,
  resetAssetDraft,
  resetDetailViewState,
  resetRuleSqlManagerState,
  routeKnowledgeBaseId,
  routeRuntimeSyncing,
  setAssetModalOpen,
  setAssetWizardStep,
  setDetailAsset,
  setDraftAssets,
  setPendingKnowledgeBaseId,
  setSelectedConnectorId,
  setSelectedDemoTable,
  setSelectedKnowledgeBaseId,
}: {
  activeKnowledgeBaseId?: string | null;
  activeKnowledgeSnapshotId?: string | null;
  currentKnowledgeBaseId?: string | null;
  hasRuntimeScope: boolean;
  loadRuleList: () => Promise<unknown>;
  loadSqlList: () => Promise<unknown>;
  pendingKnowledgeBaseId?: string | null;
  refetchReady: boolean;
  resetAssetDraft: () => void;
  resetDetailViewState: () => void;
  resetRuleSqlManagerState: () => void;
  routeKnowledgeBaseId?: string | null;
  routeRuntimeSyncing: boolean;
  setAssetModalOpen: (open: boolean) => void;
  setAssetWizardStep: (step: number) => void;
  setDetailAsset: React.Dispatch<React.SetStateAction<AssetView | null>>;
  setDraftAssets: React.Dispatch<React.SetStateAction<AssetView[]>>;
  setPendingKnowledgeBaseId: (id: string | null) => void;
  setSelectedConnectorId: (id?: string) => void;
  setSelectedDemoTable: (table?: SelectedAssetTableValue) => void;
  setSelectedKnowledgeBaseId: (id: string | null) => void;
}) {
  useKnowledgePendingSwitchSync({
    currentKnowledgeBaseId,
    routeKnowledgeBaseId,
    pendingKnowledgeBaseId,
    routeRuntimeSyncing,
    shouldCommitPendingSwitch: shouldCommitPendingKnowledgeBaseSwitch,
    setSelectedKnowledgeBaseId,
    setPendingKnowledgeBaseId,
  });

  const resetStateOnKnowledgeBaseSwitch = useKnowledgeSwitchReset<AssetView>({
    setDetailAsset,
    resetDetailViewState,
    setDraftAssets,
    setAssetModalOpen,
    setAssetWizardStep,
    resetRuleSqlManagerState,
    setSelectedConnectorId,
    setSelectedDemoTable,
    resetAssetDraft,
  });

  useKnowledgeActiveKnowledgeBaseSwitch({
    activeKnowledgeBaseId,
    switchReady: refetchReady,
    onKnowledgeBaseChanged: resetStateOnKnowledgeBaseSwitch,
  });

  useKnowledgeWorkbenchBootstrap({
    activeKnowledgeBaseId,
    activeKnowledgeSnapshotId,
    loadRuleList,
    loadSqlList,
    routeRuntimeSyncing,
    hasRuntimeScope,
  });
}

export default useKnowledgeWorkbenchSyncEffects;
