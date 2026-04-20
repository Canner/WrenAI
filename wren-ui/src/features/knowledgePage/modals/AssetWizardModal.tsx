import { ArrowRightOutlined, CloseOutlined } from '@ant-design/icons';
import { Input, List, Space, Steps, Typography, message } from 'antd';
import { memo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { KnowledgeAssetSelectOption } from '@/hooks/useKnowledgeAssetSelectOptions';
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
  SelectedAssetTableValue,
  SourceOption,
} from '@/features/knowledgePage/types';
import AssetWizardSourceStep from './AssetWizardSourceStep';

const { Text } = Typography;
const { Step } = Steps;

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
  selectedDemoTable?: SelectedAssetTableValue;
  setSelectedDemoTable: Dispatch<
    SetStateAction<SelectedAssetTableValue | undefined>
  >;
  assetDatabaseOptions: KnowledgeAssetSelectOption[];
  assetTableOptions: KnowledgeAssetSelectOption[];
  canContinueAssetWizard: boolean;
  moveAssetWizardToConfig: () => void;
  assetDraft: AssetWizardDraft;
  setAssetDraft: Dispatch<SetStateAction<AssetWizardDraft>>;
  assetDraftPreview?: AssetView | null;
  assetDraftPreviews?: AssetView[];
  canContinueAssetConfiguration: boolean;
  commitAssetDraftToOverview: () => Promise<void> | void;
  savingAssetDraft: boolean;
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
  assetDraftPreviews,
  canContinueAssetConfiguration,
  commitAssetDraftToOverview,
  savingAssetDraft,
  displayKnowledgeName,
  closeAssetModal,
  onNavigateModeling,
}: AssetWizardModalProps) {
  const hasAvailableConnectorTargets = assetDatabaseOptions.length > 0;
  const assetDraftPreviewList = assetDraftPreviews?.length
    ? assetDraftPreviews
    : assetDraftPreview
      ? [assetDraftPreview]
      : [];
  const isBatchSelection = !isDemoSource && assetDraftPreviewList.length > 1;
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
          <AssetWizardSourceStep
            visible={visible}
            activeKnowledgeBase={activeKnowledgeBase ?? null}
            assetDatabaseOptions={assetDatabaseOptions}
            assetSourceSetupNote={assetSourceSetupNote}
            assetSourceSummaryNote={assetSourceSummaryNote}
            assetTableOptions={assetTableOptions}
            canContinueAssetWizard={canContinueAssetWizard}
            closeAssetModal={closeAssetModal}
            connectorsLoading={connectorsLoading}
            hasAvailableConnectorTargets={hasAvailableConnectorTargets}
            isDemoSource={isDemoSource}
            knowledgeBases={knowledgeBases}
            moveAssetWizardToConfig={moveAssetWizardToConfig}
            openConnectorConsole={openConnectorConsole}
            selectedConnectorId={selectedConnectorId}
            selectedDemoKnowledge={selectedDemoKnowledge ?? null}
            selectedDemoTable={selectedDemoTable}
            selectedSourceType={selectedSourceType}
            setSelectedConnectorId={setSelectedConnectorId}
            setSelectedDemoTable={setSelectedDemoTable}
            setSelectedSourceType={setSelectedSourceType}
            sourceOptions={sourceOptions}
          />
        )}

        {assetWizardStep === 1 && (
          <WizardBody>
            <WizardNote>
              <strong style={{ color: '#30354a' }}>知识配置</strong>
              <div style={{ marginTop: 6 }}>
                为当前引入资产补充名称、业务描述与优先级，保存后会同步回知识库概览，再继续进入建模。
              </div>
            </WizardNote>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) 220px',
                gap: 20,
              }}
            >
              <FieldCluster>
                <SectionTitle>
                  {!isBatchSelection && <RequiredMark>*</RequiredMark>}
                  {isBatchSelection ? '资产名称前缀（可选）' : '资产名称'}
                </SectionTitle>
                <Input
                  value={assetDraft.name}
                  placeholder={
                    isBatchSelection
                      ? '可选：例如 ods_ / 业务_'
                      : '请输入资产名称'
                  }
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
            </div>

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
              dataSource={assetDraftPreviewList}
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
                  onClick={() => void commitAssetDraftToOverview()}
                  disabled={!canContinueAssetConfiguration}
                  loading={savingAssetDraft}
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
              dataSource={assetDraftPreviewList}
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
