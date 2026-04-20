import {
  AppstoreOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { Button, Empty, Select, Space, Spin, Typography } from 'antd';
import type { Dispatch, SetStateAction } from 'react';
import {
  FieldCluster,
  LightButton,
  PurpleButton,
  RequiredMark,
  SectionTitle,
  SegmentedButton,
  SegmentedRow,
  SourceCard,
  SourceCardMeta,
  SourceCardTitle,
  SourceGrid,
  WizardBody,
  WizardFooter,
  WizardNote,
} from '@/features/knowledgePage/index.styles';
import type {
  KnowledgeBaseRecord,
  SourceOption,
} from '@/features/knowledgePage/types';
import type { KnowledgeAssetSelectOption } from '@/hooks/useKnowledgeAssetSelectOptions';
import type { ReferenceDemoKnowledge } from '@/utils/referenceDemoKnowledge';

const { Text } = Typography;

type AssetWizardSourceStepProps = {
  activeKnowledgeBase?: KnowledgeBaseRecord | null;
  assetDatabaseOptions: KnowledgeAssetSelectOption[];
  canContinueSourceSelection: boolean;
  closeAssetModal: () => void;
  connectorsLoading: boolean;
  isDemoSource: boolean;
  knowledgeBases: KnowledgeBaseRecord[];
  onContinue: () => void;
  onOpenConnectorDrawer: () => void;
  selectedConnectorId?: string;
  selectedDemoKnowledge?: ReferenceDemoKnowledge | null;
  selectedSourceType: string;
  setSelectedConnectorId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedSourceType: Dispatch<SetStateAction<string>>;
  sourceOptions: SourceOption[];
};

export default function AssetWizardSourceStep({
  activeKnowledgeBase,
  assetDatabaseOptions,
  canContinueSourceSelection,
  closeAssetModal,
  connectorsLoading,
  isDemoSource,
  knowledgeBases,
  onContinue,
  onOpenConnectorDrawer,
  selectedConnectorId,
  selectedDemoKnowledge,
  selectedSourceType,
  setSelectedConnectorId,
  setSelectedSourceType,
  sourceOptions,
}: AssetWizardSourceStepProps) {
  const connectorSummaryNote = connectorsLoading
    ? '正在加载当前工作区的数据源。'
    : assetDatabaseOptions.length > 0
      ? '选择一个已配置数据源，下一步再筛选要引入的数据资产。'
      : '当前工作区还没有可用数据源，直接在这里新建并完成连接测试即可继续。';

  return (
    <WizardBody>
      <FieldCluster>
        <SectionTitle>
          <RequiredMark>*</RequiredMark>
          知识类型
        </SectionTitle>
        <SegmentedRow>
          <SegmentedButton type="button" $active>
            <DatabaseOutlined />
            表/数据集
          </SegmentedButton>
          <SegmentedButton
            type="button"
            $disabled
            disabled
            aria-disabled
            title="矩阵模型引入将在后续版本开放"
          >
            <AppstoreOutlined />
            矩阵模型
          </SegmentedButton>
        </SegmentedRow>
      </FieldCluster>

      <FieldCluster>
        <SectionTitle>
          <RequiredMark>*</RequiredMark>
          目标知识库
        </SectionTitle>
        <Select
          style={{ width: '100%' }}
          value={activeKnowledgeBase?.id}
          options={knowledgeBases.map((kb) => ({
            label: kb.name,
            value: kb.id,
          }))}
        />
      </FieldCluster>

      <SegmentedRow>
        <SegmentedButton type="button" $active>
          <PlusOutlined />
          单个/批量引入
        </SegmentedButton>
        <SegmentedButton type="button" $disabled disabled aria-disabled>
          <FolderOpenOutlined />
          支持多选数据表
        </SegmentedButton>
      </SegmentedRow>
      <Text type="secondary" style={{ fontSize: 12 }}>
        先确认数据源，再选择具体资产并补充知识配置。建议问题会在最后一步统一展示。
      </Text>

      <FieldCluster>
        <SectionTitle>
          <RequiredMark>*</RequiredMark>
          数据源类型
        </SectionTitle>
        <SourceGrid>
          {sourceOptions.map((option) => (
            <SourceCard
              key={option.key}
              type="button"
              $active={selectedSourceType === option.key}
              onClick={() => setSelectedSourceType(option.key)}
            >
              <SourceCardTitle>
                {option.icon}
                {option.label}
              </SourceCardTitle>
              <SourceCardMeta>{option.meta}</SourceCardMeta>
            </SourceCard>
          ))}
        </SourceGrid>
      </FieldCluster>

      {isDemoSource ? (
        <WizardNote>
          <strong style={{ color: '#30354a' }}>样例数据源</strong>
          <div style={{ marginTop: 6 }}>
            当前已选择
            {selectedDemoKnowledge
              ? ` “${selectedDemoKnowledge.name}”`
              : '系统样例'}
            ，下一步可选择主题表或核心字段视图。
          </div>
        </WizardNote>
      ) : (
        <FieldCluster>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <SectionTitle style={{ marginBottom: 0 }}>
              <RequiredMark>*</RequiredMark>
              已配置数据源
            </SectionTitle>
            <Button
              type="link"
              icon={<PlusOutlined />}
              onClick={onOpenConnectorDrawer}
            >
              新建数据源
            </Button>
          </div>

          {connectorsLoading ? (
            <div
              style={{
                minHeight: 180,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(15, 23, 42, 0.08)',
                borderRadius: 14,
                background: '#fff',
              }}
            >
              <Spin />
            </div>
          ) : assetDatabaseOptions.length > 0 ? (
            <SourceGrid
              style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
            >
              {assetDatabaseOptions.map((option) => (
                <SourceCard
                  key={option.value}
                  type="button"
                  $active={selectedConnectorId === option.value}
                  onClick={() => setSelectedConnectorId(option.value)}
                >
                  <SourceCardTitle>
                    <DatabaseOutlined />
                    {option.label.split(' · ')[0]}
                  </SourceCardTitle>
                  <SourceCardMeta>
                    {option.label.split(' · ').slice(1).join(' · ') ||
                      '已配置连接器'}
                  </SourceCardMeta>
                </SourceCard>
              ))}
            </SourceGrid>
          ) : (
            <div
              style={{
                border: '1px dashed rgba(15, 23, 42, 0.12)',
                borderRadius: 14,
                background: '#fff',
                padding: 18,
              }}
            >
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="当前工作区还没有可用数据源"
              >
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={onOpenConnectorDrawer}
                >
                  新建第一个数据源
                </Button>
              </Empty>
            </div>
          )}
        </FieldCluster>
      )}

      <WizardNote>
        {isDemoSource
          ? '样例数据会沿用系统预置的字段说明和问答场景，适合快速验证向导链路。'
          : connectorSummaryNote}
      </WizardNote>

      <WizardFooter>
        <Text type="secondary">
          {isDemoSource
            ? '下一步选择要引入的样例资产。'
            : selectedConnectorId
              ? '下一步选择该数据源下要引入的表。'
              : '先选择或新建一个数据源后继续。'}
        </Text>
        <Space size={12}>
          <LightButton onClick={closeAssetModal}>取消</LightButton>
          <PurpleButton
            onClick={onContinue}
            disabled={!canContinueSourceSelection}
          >
            下一步
          </PurpleButton>
        </Space>
      </WizardFooter>
    </WizardBody>
  );
}
