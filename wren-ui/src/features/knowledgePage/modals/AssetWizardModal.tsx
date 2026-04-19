import {
  AppstoreOutlined,
  ArrowRightOutlined,
  CloseOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { Button, Input, Select, Space, Steps, Typography, message } from 'antd';
import List from 'antd/lib/list';
import { memo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AssetWizardDraft } from '@/hooks/useKnowledgeAssetWizard';
import type { ReferenceDemoKnowledge } from '@/utils/referenceDemoKnowledge';
import {
  REFERENCE_MODAL_MASK_STYLE,
  WIZARD_STEP_LABELS,
} from '@/features/knowledgePage/constants';
import {
  FieldCluster,
  LightButton,
  ModalCloseButton,
  ModalHeader,
  ModalPanel,
  ModalTitle,
  PurpleButton,
  ReferenceModal,
  RequiredMark,
  SectionTitle,
  SegmentedButton,
  SegmentedRow,
  SelectGrid,
  SourceCard,
  SourceCardMeta,
  SourceCardTitle,
  SourceGrid,
  ToggleInput,
  ToggleLabel,
  WizardBody,
  WizardFooter,
  WizardNote,
  WizardSteps,
} from '@/features/knowledgePage/index.styles';
import type {
  AssetView,
  KnowledgeBaseRecord,
  SourceOption,
} from '@/features/knowledgePage/types';

const { Text } = Typography;
const { Step } = Steps;

type SelectOption = {
  label: string;
  value: string;
};

type AssetWizardModalProps = {
  visible: boolean;
  assetWizardStep: number;
  onChangeAssetWizardStep: (step: number) => void;
  activeKnowledgeBase?: KnowledgeBaseRecord | null;
  knowledgeBases: KnowledgeBaseRecord[];
  sourceOptions: SourceOption[];
  selectedSourceType: string;
  setSelectedSourceType: Dispatch<SetStateAction<string>>;
  openConnectorConsole: () => Promise<unknown> | unknown;
  isDemoSource: boolean;
  connectorsLoading: boolean;
  selectedDemoKnowledge?: ReferenceDemoKnowledge | null;
  selectedConnectorId?: string;
  setSelectedConnectorId: Dispatch<SetStateAction<string | undefined>>;
  selectedDemoTable?: string;
  setSelectedDemoTable: Dispatch<SetStateAction<string | undefined>>;
  assetDatabaseOptions: SelectOption[];
  assetTableOptions: SelectOption[];
  canContinueAssetWizard: boolean;
  moveAssetWizardToConfig: () => void;
  assetDraft: AssetWizardDraft;
  setAssetDraft: Dispatch<SetStateAction<AssetWizardDraft>>;
  assetDraftPreview?: AssetView | null;
  canContinueAssetConfiguration: boolean;
  commitAssetDraftToOverview: () => void;
  displayKnowledgeName: string;
  closeAssetModal: () => void;
  onNavigateModeling: () => Promise<unknown> | unknown;
};

function AssetWizardModal({
  visible,
  assetWizardStep,
  onChangeAssetWizardStep,
  activeKnowledgeBase,
  knowledgeBases,
  sourceOptions,
  selectedSourceType,
  setSelectedSourceType,
  openConnectorConsole,
  isDemoSource,
  connectorsLoading,
  selectedDemoKnowledge,
  selectedConnectorId,
  setSelectedConnectorId,
  selectedDemoTable,
  setSelectedDemoTable,
  assetDatabaseOptions,
  assetTableOptions,
  canContinueAssetWizard,
  moveAssetWizardToConfig,
  assetDraft,
  setAssetDraft,
  assetDraftPreview,
  canContinueAssetConfiguration,
  commitAssetDraftToOverview,
  displayKnowledgeName,
  closeAssetModal,
  onNavigateModeling,
}: AssetWizardModalProps) {
  const hasAvailableConnectorTargets = assetDatabaseOptions.length > 0;
  const assetSourceSetupNote = isDemoSource
    ? '已为系统样例预置字段与问题配置，选择主题表后即可继续进入知识配置。'
    : hasAvailableConnectorTargets
      ? '先前往工作区设置中的“数据连接器”完成 provider 选择、连接测试与保存，再回到这里继续引入资产。系统会保留当前知识库上下文，方便你继续建模与关系配置。'
      : '当前工作区不提供样例资产，请先前往工作区设置中的“数据连接器”接入真实数据库连接，完成 provider 选择、连接测试与保存后，再回到这里继续引入资产。';
  const assetSourceSummaryNote = isDemoSource
    ? '样例资产会沿用当前知识库上下文，便于快速预览问答效果。'
    : hasAvailableConnectorTargets
      ? '接入完成后，当前知识库将自动继承对应的运行上下文。'
      : '尚未检测到可用连接器；完成真实数据库连接后，这里会出现可选数据库与数据表。';

  return (
    <ReferenceModal
      visible={visible}
      title={null}
      footer={null}
      closable={false}
      onCancel={closeAssetModal}
      width={1116}
      maskStyle={REFERENCE_MODAL_MASK_STYLE}
      destroyOnClose
    >
      <ModalPanel>
        <ModalHeader>
          <ModalTitle>引入资产</ModalTitle>
          <ModalCloseButton type="button" onClick={closeAssetModal}>
            <CloseOutlined />
          </ModalCloseButton>
        </ModalHeader>

        <WizardSteps current={assetWizardStep} responsive={false}>
          {WIZARD_STEP_LABELS.map((label) => (
            <Step key={label} title={label} />
          ))}
        </WizardSteps>

        {assetWizardStep === 0 && (
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
                单个引入
              </SegmentedButton>
              <SegmentedButton
                type="button"
                $disabled
                disabled
                aria-disabled
                title="当前仅支持单个引入"
              >
                <FolderOpenOutlined />
                批量引入
              </SegmentedButton>
            </SegmentedRow>
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前版本先支持单个资产引入，保存后可继续追加更多资产。
            </Text>

            <FieldCluster>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <SectionTitle style={{ marginBottom: 0 }}>
                  <RequiredMark>*</RequiredMark>
                  来源
                </SectionTitle>
                <Button
                  type="link"
                  icon={<PlusOutlined />}
                  onClick={() => void openConnectorConsole()}
                >
                  前往数据连接器
                </Button>
              </div>
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

            <SelectGrid>
              <FieldCluster>
                <SectionTitle>
                  <RequiredMark>*</RequiredMark>
                  {isDemoSource ? '选择样例数据' : '选择数据库'}
                </SectionTitle>
                <Select
                  style={{ width: '100%' }}
                  placeholder={isDemoSource ? '请选择样例数据' : '请选择数据库'}
                  loading={connectorsLoading}
                  value={
                    isDemoSource
                      ? selectedDemoKnowledge?.id
                      : selectedConnectorId
                  }
                  onChange={(value) => {
                    if (!isDemoSource) {
                      setSelectedConnectorId(value);
                    }
                  }}
                  options={assetDatabaseOptions}
                  disabled={isDemoSource}
                />
              </FieldCluster>
              <FieldCluster>
                <SectionTitle>
                  <RequiredMark>*</RequiredMark>
                  {isDemoSource ? '选择主题表' : '选择数据表'}
                </SectionTitle>
                <Select
                  style={{ width: '100%' }}
                  placeholder={isDemoSource ? '请选择主题表' : '请选择数据表'}
                  disabled={
                    isDemoSource ? !selectedDemoKnowledge : !selectedConnectorId
                  }
                  value={isDemoSource ? selectedDemoTable : undefined}
                  onChange={(value) => {
                    if (isDemoSource) {
                      setSelectedDemoTable(value);
                    }
                  }}
                  options={assetTableOptions}
                />
              </FieldCluster>
            </SelectGrid>

            <WizardNote>{assetSourceSetupNote}</WizardNote>

            <WizardFooter>
              <div>
                <Text type="secondary">{assetSourceSummaryNote}</Text>
              </div>
              <Space size={12}>
                <LightButton onClick={closeAssetModal}>取消</LightButton>
                <PurpleButton
                  onClick={moveAssetWizardToConfig}
                  disabled={!canContinueAssetWizard}
                >
                  下一步
                </PurpleButton>
              </Space>
            </WizardFooter>
          </WizardBody>
        )}

        {assetWizardStep === 1 && (
          <WizardBody>
            <WizardNote>
              <strong style={{ color: '#30354a' }}>知识配置</strong>
              <div style={{ marginTop: 6 }}>
                为当前引入资产补充名称、业务描述与优先级，保存后会同步回知识库概览，再继续进入建模。
              </div>
            </WizardNote>

            <SelectGrid>
              <FieldCluster>
                <SectionTitle>
                  <RequiredMark>*</RequiredMark>
                  资产名称
                </SectionTitle>
                <Input
                  value={assetDraft.name}
                  placeholder="请输入资产名称"
                  onChange={(event) =>
                    setAssetDraft((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                />
              </FieldCluster>
              <FieldCluster>
                <SectionTitle>资产优先级</SectionTitle>
                <ToggleLabel>
                  <ToggleInput
                    checked={assetDraft.important}
                    type="checkbox"
                    onChange={(event) =>
                      setAssetDraft((previous) => ({
                        ...previous,
                        important: event.target.checked,
                      }))
                    }
                  />
                  标记为重点资产
                </ToggleLabel>
              </FieldCluster>
            </SelectGrid>

            <FieldCluster>
              <SectionTitle>
                <RequiredMark>*</RequiredMark>
                资产描述
              </SectionTitle>
              <Input.TextArea
                rows={4}
                value={assetDraft.description}
                placeholder="补充该资产在当前知识库中的用途、口径与注意事项"
                onChange={(event) =>
                  setAssetDraft((previous) => ({
                    ...previous,
                    description: event.target.value,
                  }))
                }
              />
            </FieldCluster>

            <List
              bordered
              style={{ borderRadius: 16, overflow: 'hidden' }}
              dataSource={assetDraftPreview ? [assetDraftPreview] : []}
              locale={{
                emptyText: isDemoSource
                  ? '当前样例还没有可展示的主题资产'
                  : '当前知识库还没有已建模资产',
              }}
              renderItem={(asset) => (
                <List.Item style={{ padding: '14px 18px' }}>
                  <Space direction="vertical" size={4}>
                    <Text strong>{asset.name}</Text>
                    <Text type="secondary">
                      {asset.kind === 'model' ? '数据表' : '视图'} ·{' '}
                      {asset.fieldCount} 个字段
                    </Text>
                  </Space>
                </List.Item>
              )}
            />

            <WizardFooter>
              <LightButton onClick={() => onChangeAssetWizardStep(0)}>
                上一步
              </LightButton>
              <Space size={12}>
                <LightButton onClick={closeAssetModal}>取消</LightButton>
                <PurpleButton
                  onClick={commitAssetDraftToOverview}
                  disabled={!canContinueAssetConfiguration}
                >
                  保存配置
                </PurpleButton>
              </Space>
            </WizardFooter>
          </WizardBody>
        )}

        {assetWizardStep === 2 && (
          <WizardBody>
            <WizardNote>
              <strong style={{ color: '#30354a' }}>保存完成</strong>
              <div style={{ marginTop: 6 }}>
                当前资产已经写入知识库概览，现在可以直接前往建模页补充字段、关系和语义配置。
              </div>
            </WizardNote>

            <List
              bordered
              style={{ borderRadius: 16, overflow: 'hidden' }}
              dataSource={assetDraftPreview ? [assetDraftPreview] : []}
              locale={{ emptyText: '暂无待保存资产' }}
              renderItem={(asset) => (
                <List.Item style={{ padding: '16px 18px' }}>
                  <Space direction="vertical" size={6}>
                    <Text strong>{asset.name}</Text>
                    <Text type="secondary">
                      {asset.kind === 'model' ? '数据表' : '视图'} ·{' '}
                      {asset.fieldCount} 个字段 · {displayKnowledgeName}
                    </Text>
                    <Text type="secondary">{asset.description}</Text>
                  </Space>
                </List.Item>
              )}
            />

            <WizardFooter>
              <LightButton onClick={() => onChangeAssetWizardStep(1)}>
                上一步
              </LightButton>
              <Space size={12}>
                <LightButton
                  onClick={() => {
                    closeAssetModal();
                    message.success(
                      '已返回知识库概览，可继续补充规则与 SQL 模板。',
                    );
                  }}
                >
                  返回知识库
                </LightButton>
                <PurpleButton
                  icon={<ArrowRightOutlined />}
                  onClick={async () => {
                    closeAssetModal();
                    await onNavigateModeling();
                  }}
                >
                  去建模
                </PurpleButton>
              </Space>
            </WizardFooter>
          </WizardBody>
        )}
      </ModalPanel>
    </ReferenceModal>
  );
}

export default memo(AssetWizardModal);
