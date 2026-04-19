import { DatabaseOutlined, TableOutlined } from '@ant-design/icons';
import {
  AssetGalleryBody,
  AssetGalleryCard,
  AssetGalleryChips,
  AssetGalleryFooter,
  AssetGalleryFooterRight,
  AssetGalleryHeader,
  AssetGalleryInfoGrid,
  AssetGalleryInfoLabel,
  AssetGalleryInfoRow,
  AssetGalleryInfoSplit,
  AssetGalleryInfoValue,
  AssetGalleryLabel,
  AssetGalleryRowMeta,
  AssetGalleryTitle,
  AssetIconBox,
  MetricPill,
} from '@/features/knowledgePage/index.styles';
import type { AssetView } from '@/features/knowledgePage/types';

type KnowledgeAssetGalleryCardProps = {
  asset: AssetView;
  active: boolean;
  onOpenAssetDetail: (asset: AssetView) => void;
};

export default function KnowledgeAssetGalleryCard({
  asset,
  active,
  onOpenAssetDetail,
}: KnowledgeAssetGalleryCardProps) {
  return (
    <AssetGalleryCard
      type="button"
      data-testid="knowledge-asset-card"
      data-asset-name={asset.name}
      $active={active}
      onClick={() => onOpenAssetDetail(asset)}
    >
      <AssetGalleryHeader>
        <AssetGalleryTitle>
          <AssetIconBox $kind={asset.kind}>
            {asset.kind === 'model' ? <DatabaseOutlined /> : <TableOutlined />}
          </AssetIconBox>
          <div style={{ minWidth: 0 }}>
            <AssetGalleryLabel title={asset.name}>
              {asset.name}
            </AssetGalleryLabel>
          </div>
        </AssetGalleryTitle>
      </AssetGalleryHeader>
      <AssetGalleryBody>
        <AssetGalleryInfoGrid>
          <AssetGalleryInfoRow>
            <AssetGalleryInfoLabel>表名</AssetGalleryInfoLabel>
            <AssetGalleryInfoSplit>
              <AssetGalleryInfoValue
                title={asset.sourceTableName || asset.name}
              >
                {asset.sourceTableName || asset.name}
              </AssetGalleryInfoValue>
              <AssetGalleryRowMeta>
                {asset.kind === 'model' ? '表资产' : '视图资产'}
              </AssetGalleryRowMeta>
            </AssetGalleryInfoSplit>
          </AssetGalleryInfoRow>
          <AssetGalleryInfoRow>
            <AssetGalleryInfoLabel>描述</AssetGalleryInfoLabel>
            <AssetGalleryInfoValue
              $multiline
              title={asset.description || '暂无资产说明'}
            >
              {asset.description || '暂无资产说明'}
            </AssetGalleryInfoValue>
          </AssetGalleryInfoRow>
        </AssetGalleryInfoGrid>
      </AssetGalleryBody>
      <AssetGalleryFooter>
        <AssetGalleryChips>
          <MetricPill>{asset.fieldCount} 个字段</MetricPill>
        </AssetGalleryChips>
        <AssetGalleryFooterRight>
          <MetricPill>{asset.kind === 'model' ? '数据表' : '视图'}</MetricPill>
        </AssetGalleryFooterRight>
      </AssetGalleryFooter>
    </AssetGalleryCard>
  );
}
