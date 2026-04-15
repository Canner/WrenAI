import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOutlined,
  CodeOutlined,
  DatabaseOutlined,
  EditOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  PlusOutlined,
  RollbackOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { Typography } from 'antd';
import {
  AssetGalleryBody,
  AssetGalleryCard,
  AssetGalleryChips,
  AssetGalleryFooter,
  AssetGalleryFooterRight,
  AssetGalleryGrid,
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
  AssetsLoadingCard,
  AssetsLoadingGrid,
  AssetsLoadingIntro,
  AssetsLoadingLine,
  AssetsLoadingStage,
  AssetsPanel,
  EmptyInner,
  EmptyStage,
  InfoRow,
  MainStage,
  MetricPill,
  Pill,
  PrimaryBlackButton,
  SummaryActions,
  SummaryCard,
  SummaryDescription,
  SummaryHeader,
  SummaryIconAction,
  SummaryInfo,
  SummaryTopRow,
} from './index.styles';
import type { AssetView } from './types';

const { Text, Title } = Typography;
const ASSET_GALLERY_INITIAL_RENDER_COUNT = 24;
const ASSET_GALLERY_RENDER_BATCH = 24;

type KnowledgeMainStageProps = {
  previewFieldCount: number;
  isSnapshotReadonlyKnowledgeBase: boolean;
  isReadonlyKnowledgeBase: boolean;
  isKnowledgeMutationDisabled: boolean;
  activeKnowledgeBaseExecutable: boolean;
  canManageKnowledgeBaseLifecycle: boolean;
  knowledgeLifecycleActionLabel: string;
  knowledgeLifecycleSubmitting: boolean;
  activeKnowledgeBaseArchivedAt?: string | null;
  knowledgeMutationHint?: string | null;
  knowledgeDescription?: string | null;
  showKnowledgeAssetsLoading: boolean;
  detailAssets: AssetView[];
  activeDetailAsset?: AssetView | null;
  onOpenAssetWizard: () => void;
  onSummaryMoreAction: (key: string) => void;
  onToggleKnowledgeArchive: () => Promise<void> | void;
  onOpenAssetDetail: (asset: AssetView) => void;
  historicalSnapshotReadonlyHint: string;
};

function KnowledgeMainStage({
  previewFieldCount,
  isSnapshotReadonlyKnowledgeBase,
  isReadonlyKnowledgeBase,
  isKnowledgeMutationDisabled,
  activeKnowledgeBaseExecutable,
  canManageKnowledgeBaseLifecycle,
  knowledgeLifecycleActionLabel,
  knowledgeLifecycleSubmitting,
  activeKnowledgeBaseArchivedAt,
  knowledgeMutationHint,
  knowledgeDescription,
  showKnowledgeAssetsLoading,
  detailAssets,
  activeDetailAsset,
  onOpenAssetWizard,
  onSummaryMoreAction,
  onToggleKnowledgeArchive,
  onOpenAssetDetail,
  historicalSnapshotReadonlyHint,
}: KnowledgeMainStageProps) {
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const [assetRenderLimit, setAssetRenderLimit] = useState(
    ASSET_GALLERY_INITIAL_RENDER_COUNT,
  );

  useEffect(() => {
    setAssetRenderLimit(ASSET_GALLERY_INITIAL_RENDER_COUNT);
  }, [detailAssets.length]);

  useEffect(() => {
    if (!activeDetailAsset) {
      return;
    }

    const activeIndex = detailAssets.findIndex(
      (asset) => asset.id === activeDetailAsset.id,
    );
    if (activeIndex < 0) {
      return;
    }

    const requiredLimit = Math.min(
      detailAssets.length,
      activeIndex + ASSET_GALLERY_RENDER_BATCH,
    );
    setAssetRenderLimit((currentLimit) =>
      currentLimit >= requiredLimit ? currentLimit : requiredLimit,
    );
  }, [activeDetailAsset?.id, detailAssets]);

  const renderedDetailAssets = useMemo(
    () => detailAssets.slice(0, assetRenderLimit),
    [assetRenderLimit, detailAssets],
  );
  const hasMoreAssets = assetRenderLimit < detailAssets.length;

  useEffect(() => {
    if (!hasMoreAssets) {
      return;
    }

    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) {
          return;
        }

        setAssetRenderLimit((currentLimit) =>
          Math.min(
            detailAssets.length,
            currentLimit + ASSET_GALLERY_RENDER_BATCH,
          ),
        );
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [detailAssets.length, hasMoreAssets]);

  return (
    <MainStage>
      <SummaryCard>
        <SummaryHeader>
          <SummaryTopRow>
            <InfoRow>
              <Pill>字段数：{previewFieldCount}/800</Pill>
              {isSnapshotReadonlyKnowledgeBase ? <Pill>历史快照</Pill> : null}
              {isReadonlyKnowledgeBase ? <Pill>系统样例</Pill> : null}
            </InfoRow>

            <SummaryActions>
              <SummaryIconAction
                type="button"
                $primary
                onClick={onOpenAssetWizard}
                title="添加资产"
                aria-label="添加资产"
                disabled={isKnowledgeMutationDisabled}
              >
                <PlusOutlined />
              </SummaryIconAction>
              <SummaryIconAction
                type="button"
                data-guideid="instructions"
                onClick={() => onSummaryMoreAction('instructions')}
                title="分析规则"
                aria-label="分析规则"
                disabled={!activeKnowledgeBaseExecutable}
              >
                <BookOutlined />
              </SummaryIconAction>
              <SummaryIconAction
                type="button"
                data-guideid="sql-templates"
                onClick={() => onSummaryMoreAction('sql-templates')}
                title="SQL 模板"
                aria-label="SQL 模板"
                disabled={!activeKnowledgeBaseExecutable}
              >
                <CodeOutlined />
              </SummaryIconAction>
              <SummaryIconAction
                type="button"
                onClick={() => onSummaryMoreAction('edit-knowledge')}
                title="编辑知识库"
                aria-label="编辑知识库"
                disabled={isKnowledgeMutationDisabled}
              >
                <EditOutlined />
              </SummaryIconAction>
              {canManageKnowledgeBaseLifecycle ? (
                <SummaryIconAction
                  type="button"
                  onClick={() => void onToggleKnowledgeArchive()}
                  title={knowledgeLifecycleActionLabel}
                  aria-label={knowledgeLifecycleActionLabel}
                  disabled={knowledgeLifecycleSubmitting}
                >
                  {activeKnowledgeBaseArchivedAt ? (
                    <RollbackOutlined />
                  ) : (
                    <InboxOutlined />
                  )}
                </SummaryIconAction>
              ) : null}
            </SummaryActions>
          </SummaryTopRow>

          <SummaryInfo>
            {knowledgeMutationHint ? (
              <SummaryDescription>{knowledgeMutationHint}</SummaryDescription>
            ) : null}
            {knowledgeDescription ? (
              <SummaryDescription>{knowledgeDescription}</SummaryDescription>
            ) : null}
          </SummaryInfo>
        </SummaryHeader>
      </SummaryCard>

      <AssetsPanel>
        {showKnowledgeAssetsLoading ? (
          <AssetsLoadingStage>
            <AssetsLoadingIntro>
              <Text strong style={{ color: '#111827' }}>
                正在同步知识库内容…
              </Text>
              <Text type="secondary">
                当前知识库的表结构与字段信息正在加载，稍后会自动展示。
              </Text>
            </AssetsLoadingIntro>
            <AssetsLoadingGrid>
              {[0, 1].map((index) => (
                <AssetsLoadingCard key={index}>
                  <AssetsLoadingLine $width="46%" $height={14} />
                  <AssetsLoadingLine $width="78%" $muted />
                  <AssetsLoadingLine $width="100%" $muted />
                  <AssetsLoadingLine $width="68%" $muted />
                  <AssetsLoadingLine $width="22%" $height={18} />
                </AssetsLoadingCard>
              ))}
            </AssetsLoadingGrid>
          </AssetsLoadingStage>
        ) : detailAssets.length > 0 ? (
          <AssetGalleryGrid>
            {renderedDetailAssets.map((asset) => (
              <AssetGalleryCard
                key={asset.id}
                type="button"
                $active={asset.id === activeDetailAsset?.id}
                onClick={() => onOpenAssetDetail(asset)}
              >
                <AssetGalleryHeader>
                  <AssetGalleryTitle>
                    <AssetIconBox $kind={asset.kind}>
                      {asset.kind === 'model' ? (
                        <DatabaseOutlined />
                      ) : (
                        <TableOutlined />
                      )}
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
                    <MetricPill>
                      {asset.kind === 'model' ? '数据表' : '视图'}
                    </MetricPill>
                  </AssetGalleryFooterRight>
                </AssetGalleryFooter>
              </AssetGalleryCard>
            ))}
            {hasMoreAssets ? (
              <div
                ref={loadMoreSentinelRef}
                style={{ width: '100%', height: 1, gridColumn: '1 / -1' }}
                aria-hidden
              />
            ) : null}
          </AssetGalleryGrid>
        ) : (
          <EmptyStage>
            <EmptyInner>
              <FolderOpenOutlined style={{ fontSize: 48, color: '#c4c8d5' }} />
              <Title level={4} style={{ margin: 0 }}>
                知识库为空
              </Title>
              <Text type="secondary">
                {isReadonlyKnowledgeBase
                  ? '系统样例已预置结构与问答配置，可直接浏览体验。'
                  : isSnapshotReadonlyKnowledgeBase
                    ? historicalSnapshotReadonlyHint
                    : '先添加资产，后续这里会展示表、视图与字段概览。'}
              </Text>
              {!isKnowledgeMutationDisabled ? (
                <PrimaryBlackButton type="button" onClick={onOpenAssetWizard}>
                  <PlusOutlined />
                  <span>添加资产</span>
                </PrimaryBlackButton>
              ) : null}
            </EmptyInner>
          </EmptyStage>
        )}
      </AssetsPanel>
    </MainStage>
  );
}

export default KnowledgeMainStage;
