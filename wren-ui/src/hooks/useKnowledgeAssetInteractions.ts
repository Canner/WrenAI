import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { message } from 'antd';

type AssetFieldLike = {
  fieldName: string;
  fieldType?: string | null;
  aiName?: string | null;
  isPrimaryKey?: boolean;
  isCalculated?: boolean;
};

export type KnowledgeAssetOverviewTarget = {
  name: string;
  kind: 'model' | 'view';
  fieldCount: number;
  primaryKey?: string | null;
  sourceTableName?: string | null;
  description?: string | null;
  sourceSql?: string | null;
  fields: AssetFieldLike[];
};

export const buildKnowledgeAssetOverview = (
  asset: KnowledgeAssetOverviewTarget,
) =>
  [
    `资产名称：${asset.name}`,
    `资产类型：${asset.kind === 'model' ? '数据表' : '视图'}`,
    `字段数：${asset.fieldCount}`,
    `主键：${asset.primaryKey || '未声明'}`,
    `来源：${asset.sourceTableName || '未声明'}`,
    `资产描述：${asset.description || '暂无资产说明'}`,
    '',
    '字段列表：',
    ...asset.fields.map(
      (field) =>
        `- ${field.aiName || field.fieldName} (${field.fieldName}) · ${field.fieldType}${field.isPrimaryKey ? ' · 主键' : ''}${field.isCalculated ? ' · 计算字段' : ''}`,
    ),
    asset.sourceSql ? ['', 'SQL / 语句定义：', asset.sourceSql].join('\n') : '',
  ].join('\n');

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

export default function useKnowledgeAssetInteractions<
  TAsset extends KnowledgeAssetOverviewTarget,
>({
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

  const handleCopyAssetOverview = useCallback(async (asset: TAsset) => {
    const assetSummary = buildKnowledgeAssetOverview(asset);

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(assetSummary);
        message.success('资产概览已复制');
        return;
      }

      throw new Error('Clipboard API unavailable');
    } catch (_error) {
      message.info('当前环境暂不支持直接复制，请手动选中字段内容。');
    }
  }, []);

  return {
    commitAssetDraftToOverview,
    openAssetDetail,
    handleCopyAssetOverview,
  };
}
