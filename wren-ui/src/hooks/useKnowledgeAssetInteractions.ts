import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { message } from 'antd';

type MaybePromise<T> = T | Promise<T>;

export const commitKnowledgeAssetDraft = async <TAsset>({
  saveAssetDraftToOverview,
  blurActiveElement,
  resetDetailViewState,
}: {
  saveAssetDraftToOverview: () => MaybePromise<TAsset | null>;
  blurActiveElement: () => void;
  resetDetailViewState: () => void;
}) => {
  const persistedAsset = await saveAssetDraftToOverview();
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
  saveAssetDraftToOverview: () => MaybePromise<TAsset | null>;
  blurActiveElement: () => void;
  resetDetailViewState: () => void;
  openModalSafely: (action: () => void) => void;
  setDetailAsset: Dispatch<SetStateAction<TAsset | null>>;
}) {
  const [savingAssetDraft, setSavingAssetDraft] = useState(false);

  const commitAssetDraftToOverview = useCallback(async () => {
    if (savingAssetDraft) {
      return;
    }

    setSavingAssetDraft(true);
    try {
      const persistedAsset = await commitKnowledgeAssetDraft({
        saveAssetDraftToOverview,
        blurActiveElement,
        resetDetailViewState,
      });
      if (!persistedAsset) {
        return;
      }

      message.success('资产配置已保存到当前知识库概览，可继续前往建模。');
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : '保存资产失败，请稍后重试。',
      );
    } finally {
      setSavingAssetDraft(false);
    }
  }, [
    blurActiveElement,
    resetDetailViewState,
    saveAssetDraftToOverview,
    savingAssetDraft,
  ]);

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
    savingAssetDraft,
  };
}
