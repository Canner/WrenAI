import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AssetWizardDraft } from './useKnowledgeAssetWizard';

export const createDefaultKnowledgeAssetDraft = (): AssetWizardDraft => ({
  name: '',
  description: '',
  important: true,
});

export const resetKnowledgeAssetDraftState = ({
  setAssetDraft,
}: {
  setAssetDraft: Dispatch<SetStateAction<AssetWizardDraft>>;
}) => {
  setAssetDraft(createDefaultKnowledgeAssetDraft());
};

export default function useKnowledgeAssetDraftState() {
  const [assetDraft, setAssetDraft] = useState<AssetWizardDraft>(
    createDefaultKnowledgeAssetDraft,
  );

  const resetAssetDraft = useCallback(
    () =>
      resetKnowledgeAssetDraftState({
        setAssetDraft,
      }),
    [],
  );

  return {
    assetDraft,
    setAssetDraft,
    resetAssetDraft,
  };
}
