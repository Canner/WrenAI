import { memo, type ReactNode, useEffect } from 'react';
import { Button, Typography } from 'antd';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import type { KnowledgeDetailFieldFilter } from '@/hooks/useKnowledgeAssetDetail';
import {
  AssetDetailHead,
  AssetDetailHero,
  AssetDetailIconButton,
  AssetDetailMain,
  AssetDetailMetaPills,
  AssetDetailTab,
  AssetDetailTabs,
  AssetDetailToolbar,
  AssetDetailMetaPill,
} from '@/features/knowledgePage/index.styles';
import type { AssetView } from '@/features/knowledgePage/types';
import { summarizeAssetFieldGovernance } from '@/utils/knowledgeWorkbenchEditor';
import AssetDetailFieldOverview from './AssetDetailFieldOverview';
import AssetDetailUsagePanel from './AssetDetailUsagePanel';
import type { AssetDetailFieldRow } from './assetDetailContentTypes';

const { Paragraph, Text, Title } = Typography;

type AssetDetailContentProps = {
  activeDetailAsset: AssetView;
  detailTab: 'overview' | 'fields' | 'usage';
  detailFieldKeyword: string;
  detailFieldFilter: KnowledgeDetailFieldFilter;
  detailAssetFields: AssetDetailFieldRow[];
  canCreateKnowledgeArtifacts?: boolean;
  onClose: () => void;
  onNavigateModeling: () => void;
  onCreateRuleDraft?: (asset: AssetView) => Promise<void> | void;
  onCreateSqlTemplateDraft?: (asset: AssetView) => Promise<void> | void;
  onChangeDetailTab: (tab: 'overview' | 'fields' | 'usage') => void;
  onChangeFieldKeyword: (keyword: string) => void;
  onChangeFieldFilter: (filter: KnowledgeDetailFieldFilter) => void;
};

function AssetDetailContent({
  activeDetailAsset,
  detailTab,
  detailFieldKeyword,
  detailFieldFilter,
  detailAssetFields,
  canCreateKnowledgeArtifacts = false,
  onClose,
  onNavigateModeling,
  onCreateRuleDraft,
  onCreateSqlTemplateDraft,
  onChangeDetailTab,
  onChangeFieldKeyword,
  onChangeFieldFilter,
}: AssetDetailContentProps) {
  const fieldGovernance = summarizeAssetFieldGovernance(
    activeDetailAsset.fields || [],
  );
  const effectiveDetailTab = detailTab === 'fields' ? 'overview' : detailTab;

  useEffect(() => {
    if (detailTab === 'fields') {
      onChangeDetailTab('overview');
    }
  }, [detailTab, onChangeDetailTab]);

  return (
    <AssetDetailMain style={{ paddingLeft: 0 }}>
      <AssetDetailHero>
        <AssetDetailHead>
          <div style={{ minWidth: 0 }}>
            <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.2 }}>
              资产详情
            </Text>
            <ModalLikeTitle>{activeDetailAsset.name}</ModalLikeTitle>
            {activeDetailAsset.description ? (
              <Paragraph
                style={{
                  margin: '6px 0 0',
                  maxWidth: 720,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: '#6b7280',
                }}
              >
                {activeDetailAsset.description}
              </Paragraph>
            ) : null}
            <AssetDetailMetaPills>
              <AssetDetailMetaPill>
                字段数 {activeDetailAsset.fieldCount}
              </AssetDetailMetaPill>
              <AssetDetailMetaPill>
                类型 {activeDetailAsset.kind === 'model' ? '数据表' : '视图'}
              </AssetDetailMetaPill>
            </AssetDetailMetaPills>
          </div>
          <AssetDetailToolbar>
            <Button
              type="default"
              icon={<EditOutlined />}
              onClick={onNavigateModeling}
            >
              去建模
            </Button>
            <AssetDetailIconButton
              type="button"
              onClick={onClose}
              title="收起资产详情"
            >
              <CloseOutlined />
            </AssetDetailIconButton>
          </AssetDetailToolbar>
        </AssetDetailHead>
      </AssetDetailHero>

      <AssetDetailTabs>
        <AssetDetailTab
          type="button"
          $active={effectiveDetailTab === 'overview'}
          onClick={() => onChangeDetailTab('overview')}
        >
          概览
        </AssetDetailTab>
        <AssetDetailTab
          type="button"
          $active={effectiveDetailTab === 'usage'}
          onClick={() => onChangeDetailTab('usage')}
        >
          推荐问法
        </AssetDetailTab>
      </AssetDetailTabs>

      {effectiveDetailTab === 'overview' ? (
        <AssetDetailFieldOverview
          detailFieldKeyword={detailFieldKeyword}
          detailFieldFilter={detailFieldFilter}
          detailAssetFields={detailAssetFields}
          fieldGovernance={fieldGovernance}
          onChangeFieldKeyword={onChangeFieldKeyword}
          onChangeFieldFilter={onChangeFieldFilter}
        />
      ) : null}

      {effectiveDetailTab === 'usage' ? (
        <AssetDetailUsagePanel
          activeDetailAsset={activeDetailAsset}
          canCreateKnowledgeArtifacts={canCreateKnowledgeArtifacts}
          onCreateRuleDraft={onCreateRuleDraft}
          onCreateSqlTemplateDraft={onCreateSqlTemplateDraft}
        />
      ) : null}
    </AssetDetailMain>
  );
}

function ModalLikeTitle({ children }: { children: ReactNode }) {
  return (
    <Title level={4} style={{ fontSize: 20, marginTop: 4, marginBottom: 0 }}>
      {children}
    </Title>
  );
}

export default memo(AssetDetailContent);
