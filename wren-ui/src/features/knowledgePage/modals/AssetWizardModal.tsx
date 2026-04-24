import { ArrowRightOutlined, CloseOutlined } from '@ant-design/icons';
import { Input, List, Space, Spin, Tag, Typography } from 'antd';
import { memo, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { appMessage as message } from '@/utils/antdAppBridge';
import type { KnowledgeAssetSelectOption } from '@/hooks/useKnowledgeAssetSelectOptions';
import type { AssetWizardDraft } from '@/hooks/useKnowledgeAssetWizard';
import { resolveClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type { DiagramModelRecommendation } from '@/types/modeling';
import {
  fetchModelRecommendationQuestions,
  generateModelRecommendationQuestions,
} from '@/utils/modelingRest';
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
import type { ModelingAssistantIntent } from '@/features/knowledgePage/knowledgeWorkbenchControllerStageViewTypes';
import AssetWizardAssetStep from './AssetWizardAssetStep';
import AssetWizardConnectorDrawer from './AssetWizardConnectorDrawer';
import AssetWizardSourceStep from './AssetWizardSourceStep';

const { Text } = Typography;
type AssetWizardModalProps = {
  visible: boolean;
  assetWizardStep: number;
  onChangeAssetWizardStep: (step: number) => void;
  activeKnowledgeBase?: KnowledgeBaseRecord | null;
  knowledgeBases: KnowledgeBaseRecord[];
  sourceOptions: SourceOption[];
  selectedSourceType: string;
  setSelectedSourceType: Dispatch<SetStateAction<string>>;
  openConnectorConsole?: () => Promise<unknown> | unknown;
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
  persistedAssetDraftPreviews?: AssetView[];
  recommendationRuntimeSelector?: ClientRuntimeScopeSelector | null;
  canContinueAssetConfiguration: boolean;
  commitAssetDraftToOverview: () => Promise<void> | void;
  savingAssetDraft: boolean;
  displayKnowledgeName: string;
  closeAssetModal: () => void;
  loadConnectors?: () => Promise<unknown> | unknown;
  onFinalizePersistedRuntimeScope?: () => Promise<unknown> | unknown;
  onNavigateModeling: (
    intent?: ModelingAssistantIntent,
  ) => Promise<unknown> | unknown;
  onRefreshAssets?: () => Promise<unknown> | unknown;
};

const createEmptyRecommendationState = (): DiagramModelRecommendation => ({
  error: null,
  queryId: null,
  questions: [],
  status: 'NOT_STARTED',
  updatedAt: null,
});

const getAssetRecommendationState = (
  asset: AssetView,
): DiagramModelRecommendation =>
  asset.recommendation || createEmptyRecommendationState();

const getRecommendationStatusMeta = (
  status: DiagramModelRecommendation['status'],
) => {
  switch (status) {
    case 'GENERATING':
      return {
        color: 'processing',
        label: '生成中',
      } as const;
    case 'FINISHED':
      return {
        color: 'success',
        label: '已完成',
      } as const;
    case 'FAILED':
      return {
        color: 'error',
        label: '失败',
      } as const;
    default:
      return {
        color: 'default',
        label: '待生成',
      } as const;
  }
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
  openConnectorConsole: _openConnectorConsole,
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
  persistedAssetDraftPreviews,
  recommendationRuntimeSelector,
  canContinueAssetConfiguration,
  commitAssetDraftToOverview,
  savingAssetDraft,
  displayKnowledgeName,
  closeAssetModal,
  loadConnectors,
  onFinalizePersistedRuntimeScope,
  onNavigateModeling,
  onRefreshAssets,
}: AssetWizardModalProps) {
  const assetConfigPreviewList = assetDraftPreviews?.length
    ? assetDraftPreviews
    : assetDraftPreview
      ? [assetDraftPreview]
      : [];
  const assetDraftPreviewList = persistedAssetDraftPreviews?.length
    ? persistedAssetDraftPreviews
    : assetConfigPreviewList;
  const isBatchSelection = !isDemoSource && assetConfigPreviewList.length > 1;
  const canContinueSourceSelection = isDemoSource
    ? Boolean(selectedDemoKnowledge)
    : Boolean(selectedConnectorId);
  const recommendationTargets = useMemo(
    () =>
      assetDraftPreviewList.filter(
        (asset) => asset.kind === 'model' && Boolean(asset.modelId),
      ),
    [assetDraftPreviewList],
  );
  const recommendationStateKey = useMemo(
    () =>
      recommendationTargets
        .map(
          (asset) =>
            `${asset.id}:${asset.modelId}:${asset.recommendation?.status || 'NOT_STARTED'}:${asset.recommendation?.queryId || ''}:${asset.recommendation?.updatedAt || ''}`,
        )
        .join('|'),
    [recommendationTargets],
  );
  const [recommendationStates, setRecommendationStates] = useState<
    Record<string, DiagramModelRecommendation>
  >({});
  const [connectorDrawerOpen, setConnectorDrawerOpen] = useState(false);
  const connectorWorkspaceId =
    activeKnowledgeBase?.workspaceId ||
    recommendationRuntimeSelector?.workspaceId ||
    null;
  const handleCloseAssetModal = () => {
    closeAssetModal();
    void onFinalizePersistedRuntimeScope?.();
  };

  useEffect(() => {
    if (assetWizardStep !== 3) {
      return;
    }

    setRecommendationStates(
      Object.fromEntries(
        assetDraftPreviewList.map((asset) => [
          asset.id,
          getAssetRecommendationState(asset),
        ]),
      ),
    );
  }, [assetDraftPreviewList, assetWizardStep]);

  useEffect(() => {
    if (
      !visible ||
      assetWizardStep !== 3 ||
      isDemoSource ||
      recommendationTargets.length === 0
    ) {
      return;
    }

    const selector =
      recommendationRuntimeSelector || resolveClientRuntimeScopeSelector();
    let cancelled = false;

    const syncRecommendation = async (asset: AssetView) => {
      if (!asset.modelId) {
        return;
      }

      let recommendation = getAssetRecommendationState(asset);

      try {
        if (recommendation.status === 'NOT_STARTED') {
          recommendation = await generateModelRecommendationQuestions(
            selector,
            asset.modelId,
          );
          if (cancelled) {
            return;
          }
          setRecommendationStates((previous) => ({
            ...previous,
            [asset.id]: recommendation,
          }));
          await onRefreshAssets?.();
        }

        while (!cancelled && recommendation.status === 'GENERATING') {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          if (cancelled) {
            return;
          }

          recommendation = await fetchModelRecommendationQuestions(
            selector,
            asset.modelId,
          );
          if (cancelled) {
            return;
          }

          setRecommendationStates((previous) => ({
            ...previous,
            [asset.id]: recommendation,
          }));

          if (recommendation.status !== 'GENERATING') {
            await onRefreshAssets?.();
          }
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setRecommendationStates((previous) => ({
          ...previous,
          [asset.id]: {
            ...recommendation,
            error: {
              message:
                error instanceof Error
                  ? error.message
                  : '生成建议问题失败，请稍后重试。',
            },
            status: 'FAILED',
            updatedAt: new Date().toISOString(),
          },
        }));
      }
    };

    void Promise.allSettled(recommendationTargets.map(syncRecommendation));

    return () => {
      cancelled = true;
    };
  }, [
    assetWizardStep,
    isDemoSource,
    onRefreshAssets,
    recommendationRuntimeSelector,
    recommendationStateKey,
    recommendationTargets,
    visible,
  ]);

  return (
    <ReferenceModal
      open={visible}
      title={null}
      footer={null}
      closable={false}
      onCancel={handleCloseAssetModal}
      width={1116}
      styles={{ mask: REFERENCE_MODAL_MASK_STYLE }}
      destroyOnHidden
    >
      <ModalPanel>
        <ModalHeader>
          <ModalTitle>引入资产</ModalTitle>
          <ModalCloseButton type="button" onClick={handleCloseAssetModal}>
            <CloseOutlined />
          </ModalCloseButton>
        </ModalHeader>

        <WizardSteps
          current={assetWizardStep}
          responsive={false}
          items={WIZARD_STEP_LABELS.map((label) => ({
            key: label,
            title: label,
          }))}
        />

        {assetWizardStep === 0 && (
          <AssetWizardSourceStep
            activeKnowledgeBase={activeKnowledgeBase ?? null}
            assetDatabaseOptions={assetDatabaseOptions}
            canContinueSourceSelection={canContinueSourceSelection}
            closeAssetModal={handleCloseAssetModal}
            connectorsLoading={connectorsLoading}
            isDemoSource={isDemoSource}
            knowledgeBases={knowledgeBases}
            onContinue={() => onChangeAssetWizardStep(1)}
            onOpenConnectorDrawer={() => setConnectorDrawerOpen(true)}
            selectedConnectorId={selectedConnectorId}
            selectedDemoKnowledge={selectedDemoKnowledge ?? null}
            selectedSourceType={selectedSourceType}
            setSelectedConnectorId={setSelectedConnectorId}
            setSelectedSourceType={setSelectedSourceType}
            sourceOptions={sourceOptions}
          />
        )}

        {assetWizardStep === 1 && (
          <AssetWizardAssetStep
            assetDatabaseOptions={assetDatabaseOptions}
            assetTableOptions={assetTableOptions}
            canContinueAssetWizard={canContinueAssetWizard}
            closeAssetModal={handleCloseAssetModal}
            isDemoSource={isDemoSource}
            moveAssetWizardToConfig={moveAssetWizardToConfig}
            onBack={() => onChangeAssetWizardStep(0)}
            selectedConnectorId={selectedConnectorId}
            selectedDemoKnowledge={selectedDemoKnowledge ?? null}
            selectedDemoTable={selectedDemoTable}
            setSelectedDemoTable={setSelectedDemoTable}
            open={visible}
          />
        )}

        {assetWizardStep === 2 && (
          <WizardBody>
            <WizardNote>
              <strong style={{ color: '#30354a' }}>知识配置</strong>
              <div style={{ marginTop: 6 }}>
                为当前引入资产补充名称、业务描述与优先级，保存后会同步回知识库概览，并开始生成可直接使用的建议问题。
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
                  <Space orientation="vertical" size={4}>
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
              <LightButton onClick={() => onChangeAssetWizardStep(1)}>
                上一步
              </LightButton>
              <Space size={12}>
                <LightButton onClick={handleCloseAssetModal}>取消</LightButton>
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

        {assetWizardStep === 3 && (
          <WizardBody>
            <WizardNote>
              <strong style={{ color: '#30354a' }}>建议问题</strong>
              <div style={{ marginTop: 6 }}>
                {isDemoSource
                  ? '样例资产已经写入当前知识库，下面展示的是可直接使用的预置问法。'
                  : '资产已经保存，系统正在按模型语义生成建议问题。你可以留在这里查看结果，也可以先去建模，生成完成后会同步回资产详情。'}
              </div>
            </WizardNote>

            <List
              bordered
              style={{ borderRadius: 16, overflow: 'hidden' }}
              dataSource={assetDraftPreviewList}
              locale={{ emptyText: '暂无待保存资产' }}
              renderItem={(asset) => {
                const recommendation =
                  recommendationStates[asset.id] ||
                  getAssetRecommendationState(asset);
                const statusMeta = getRecommendationStatusMeta(
                  asset.kind === 'view' && isDemoSource
                    ? 'FINISHED'
                    : recommendation.status,
                );
                const suggestedQuestions =
                  recommendation.questions.length > 0
                    ? recommendation.questions
                    : (asset.suggestedQuestions || []).map((question) => ({
                        question,
                      }));

                return (
                  <List.Item style={{ padding: '16px 18px' }}>
                    <Space
                      orientation="vertical"
                      size={8}
                      style={{ width: '100%' }}
                    >
                      <Space align="center" size={8} wrap>
                        <Text strong>{asset.name}</Text>
                        <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
                      </Space>
                      <Text type="secondary">
                        {asset.kind === 'model' ? '数据表' : '视图'} ·{' '}
                        {asset.fieldCount} 个字段 · {displayKnowledgeName}
                      </Text>
                      {asset.description ? (
                        <Text type="secondary">{asset.description}</Text>
                      ) : null}
                      {statusMeta.label === '生成中' ? (
                        <Space size={8} align="center">
                          <Spin size="small" />
                          <Text type="secondary">
                            正在分析字段语义与可回答问题，完成后会自动展示。
                          </Text>
                        </Space>
                      ) : null}
                      {statusMeta.label === '失败' ? (
                        <Text type="danger">
                          {recommendation.error?.message ||
                            '建议问题生成失败，请稍后重试。'}
                        </Text>
                      ) : null}
                      {suggestedQuestions.length > 0 ? (
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: 18,
                            color: '#30354a',
                          }}
                        >
                          {suggestedQuestions.slice(0, 3).map((item) => (
                            <li key={`${asset.id}-${item.question}`}>
                              {item.question}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {statusMeta.label === '已完成' &&
                      suggestedQuestions.length === 0 ? (
                        <Text type="secondary">
                          当前模型暂未生成可直接使用的建议问题，后续可继续在问答过程中沉淀。
                        </Text>
                      ) : null}
                    </Space>
                  </List.Item>
                );
              }}
            />

            <WizardFooter>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {!isDemoSource && recommendationTargets.length > 0
                  ? '建议问题会在生成完成后自动写回资产详情页。'
                  : '可以直接带着这些预置问法进入后续建模或知识配置。'}
              </Text>
              <Space size={12}>
                <LightButton
                  onClick={() => {
                    handleCloseAssetModal();
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
                    await onNavigateModeling(
                      isBatchSelection ? 'relationships' : undefined,
                    );
                  }}
                >
                  {isBatchSelection ? '去生成表关系' : '去建模'}
                </PurpleButton>
              </Space>
            </WizardFooter>
          </WizardBody>
        )}
      </ModalPanel>
      <AssetWizardConnectorDrawer
        open={connectorDrawerOpen}
        workspaceId={connectorWorkspaceId}
        onClose={() => setConnectorDrawerOpen(false)}
        onRefreshConnectors={async () => {
          await loadConnectors?.();
        }}
        onConnectorCreated={async (connectorId) => {
          setSelectedSourceType('database');
          setSelectedConnectorId(connectorId);
        }}
      />
    </ReferenceModal>
  );
}

export default memo(AssetWizardModal);
