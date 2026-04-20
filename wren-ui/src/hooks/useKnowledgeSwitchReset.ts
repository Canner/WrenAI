import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SelectedAssetTableValue } from '@/features/knowledgePage/types';

type AssetLike = {
  id: string;
};

export const resetKnowledgeStateForSwitch = <TAsset extends AssetLike>({
  setDetailAsset,
  resetDetailViewState,
  setDraftAssets,
  setAssetModalOpen,
  setAssetWizardStep,
  resetRuleSqlManagerState,
  setSelectedConnectorId,
  setSelectedDemoTable,
  resetAssetDraft,
}: {
  setDetailAsset: Dispatch<SetStateAction<TAsset | null>>;
  resetDetailViewState: () => void;
  setDraftAssets: Dispatch<SetStateAction<TAsset[]>>;
  setAssetModalOpen: (open: boolean) => void;
  setAssetWizardStep: (step: number) => void;
  resetRuleSqlManagerState: () => void;
  setSelectedConnectorId: (value?: string) => void;
  setSelectedDemoTable: (value?: SelectedAssetTableValue) => void;
  resetAssetDraft: () => void;
}) => {
  setDetailAsset(null);
  resetDetailViewState();
  setDraftAssets([]);
  setAssetModalOpen(false);
  setAssetWizardStep(0);
  resetRuleSqlManagerState();
  setSelectedConnectorId(undefined);
  setSelectedDemoTable(undefined);
  resetAssetDraft();
};

export default function useKnowledgeSwitchReset<TAsset extends AssetLike>({
  setDetailAsset,
  resetDetailViewState,
  setDraftAssets,
  setAssetModalOpen,
  setAssetWizardStep,
  resetRuleSqlManagerState,
  setSelectedConnectorId,
  setSelectedDemoTable,
  resetAssetDraft,
}: {
  setDetailAsset: Dispatch<SetStateAction<TAsset | null>>;
  resetDetailViewState: () => void;
  setDraftAssets: Dispatch<SetStateAction<TAsset[]>>;
  setAssetModalOpen: (open: boolean) => void;
  setAssetWizardStep: (step: number) => void;
  resetRuleSqlManagerState: () => void;
  setSelectedConnectorId: (value?: string) => void;
  setSelectedDemoTable: (value?: SelectedAssetTableValue) => void;
  resetAssetDraft: () => void;
}) {
  return useCallback(
    () =>
      resetKnowledgeStateForSwitch({
        setDetailAsset,
        resetDetailViewState,
        setDraftAssets,
        setAssetModalOpen,
        setAssetWizardStep,
        resetRuleSqlManagerState,
        setSelectedConnectorId,
        setSelectedDemoTable,
        resetAssetDraft,
      }),
    [
      resetAssetDraft,
      resetDetailViewState,
      resetRuleSqlManagerState,
      setAssetModalOpen,
      setAssetWizardStep,
      setDetailAsset,
      setDraftAssets,
      setSelectedConnectorId,
      setSelectedDemoTable,
    ],
  );
}
