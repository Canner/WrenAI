import { Drawer } from 'antd';
import type { KnowledgeDetailFieldFilter } from '@/hooks/useKnowledgeAssetDetail';
import AssetDetailContent from '@/features/knowledgePage/sections/AssetDetailContent';
import type { AssetView } from '@/features/knowledgePage/types';
import type {
  KnowledgeAssetDetailField,
  KnowledgeWorkbenchDetailTab,
} from './knowledgeWorkbenchShared';

type KnowledgeAssetDetailDrawerProps = {
  activeDetailAsset?: AssetView | null;
  detailTab: KnowledgeWorkbenchDetailTab;
  detailFieldKeyword: string;
  detailFieldFilter: KnowledgeDetailFieldFilter;
  detailAssetFields: KnowledgeAssetDetailField[];
  canCreateKnowledgeArtifacts: boolean;
  onCloseAssetDetail: () => void;
  onOpenModeling: () => void;
  onCreateRuleDraft?: (asset: AssetView) => void;
  onCreateSqlTemplateDraft?: (asset: AssetView) => void;
  onChangeDetailTab: (tab: KnowledgeWorkbenchDetailTab) => void;
  onChangeFieldKeyword: (keyword: string) => void;
  onChangeFieldFilter: (filter: KnowledgeDetailFieldFilter) => void;
};

export default function KnowledgeAssetDetailDrawer({
  activeDetailAsset,
  detailTab,
  detailFieldKeyword,
  detailFieldFilter,
  detailAssetFields,
  canCreateKnowledgeArtifacts,
  onCloseAssetDetail,
  onOpenModeling,
  onCreateRuleDraft,
  onCreateSqlTemplateDraft,
  onChangeDetailTab,
  onChangeFieldKeyword,
  onChangeFieldFilter,
}: KnowledgeAssetDetailDrawerProps) {
  return (
    <Drawer
      destroyOnClose={false}
      placement="right"
      closable={false}
      title={null}
      open={Boolean(activeDetailAsset)}
      onClose={onCloseAssetDetail}
      width="60vw"
      bodyStyle={{ padding: 20, background: '#ffffff' }}
      headerStyle={{ display: 'none' }}
    >
      {activeDetailAsset ? (
        <AssetDetailContent
          activeDetailAsset={activeDetailAsset}
          detailTab={detailTab}
          detailFieldKeyword={detailFieldKeyword}
          detailFieldFilter={detailFieldFilter}
          detailAssetFields={detailAssetFields}
          canCreateKnowledgeArtifacts={canCreateKnowledgeArtifacts}
          onClose={onCloseAssetDetail}
          onNavigateModeling={onOpenModeling}
          onCreateRuleDraft={onCreateRuleDraft}
          onCreateSqlTemplateDraft={onCreateSqlTemplateDraft}
          onChangeDetailTab={onChangeDetailTab}
          onChangeFieldKeyword={onChangeFieldKeyword}
          onChangeFieldFilter={onChangeFieldFilter}
        />
      ) : null}
    </Drawer>
  );
}
