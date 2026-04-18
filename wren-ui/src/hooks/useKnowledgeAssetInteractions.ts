import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { message } from 'antd';

export const commitKnowledgeAssetDraft = <TAsset>({
  saveAssetDraftToOverview,
  blurActiveElement,
  resetDetailViewState,
}: {
  saveAssetDraftToOverview: () => TAsset | null;
  blurActiveElement: () => void;
  resetDetailViewState: () => void;
}) => {
  const persistedAsset = saveAssetDraftToOverview();
  if (!persistedAsset) {
    return null;
  }

  blurActiveElement();
  resetDetailViewState();
  return persistedAsset;
};

export default function useKnowledgeAssetInteractions<TAsset>({
  saveAssetDraftToOverview,
  blurActiveElement,
  resetDetailViewState,
  openModalSafely,
  setDetailAsset,
}: {
  saveAssetDraftToOverview: () => TAsset | null;
  blurActiveElement: () => void;
  resetDetailViewState: () => void;
  openModalSafely: (action: () => void) => void;
  setDetailAsset: Dispatch<SetStateAction<TAsset | null>>;
}) {
  const commitAssetDraftToOverview = useCallback(() => {
    const persistedAsset = commitKnowledgeAssetDraft({
      saveAssetDraftToOverview,
      blurActiveElement,
      resetDetailViewState,
    });
    if (!persistedAsset) {
      return;
    }

    message.success('资产配置已保存到当前知识库概览，可继续前往建模。');
  }, [blurActiveElement, resetDetailViewState, saveAssetDraftToOverview]);

  const openAssetDetail = useCallback(
    (asset: TAsset) => {
      openModalSafely(() => {
        setDetailAsset(asset);
        resetDetailViewState();
      });
    },
    [openModalSafely, resetDetailViewState, setDetailAsset],
  );

  return {
    commitAssetDraftToOverview,
    openAssetDetail,
  };
}
