import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from 'react';
import { Button, Input, Space, Table, Tag, Typography } from 'antd';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import CopyOutlined from '@ant-design/icons/CopyOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import type { KnowledgeDetailFieldFilter } from '@/hooks/useKnowledgeAssetDetail';
import {
  AssetDetailEmptyPill,
  AssetDetailFilterPill,
  AssetDetailFilterPills,
  AssetDetailFilterRow,
  AssetDetailHead,
  AssetDetailHero,
  AssetDetailIconButton,
  AssetDetailMain,
  AssetDetailMetaPill,
  AssetDetailMetaPills,
  AssetDetailModalBody,
  AssetDetailQuestionList,
  AssetDetailSection,
  AssetDetailSidebar,
  AssetDetailSidebarItem,
  AssetDetailSidebarList,
  AssetDetailSqlPreview,
  AssetDetailSummaryCard,
  AssetDetailSummaryGrid,
  AssetDetailTableWrap,
  AssetDetailTab,
  AssetDetailTabs,
  AssetDetailToolbar,
  ModalCloseButton,
  ModalPanel,
  ModalTitle,
  ReferenceModal,
} from './index.styles';
import type { AssetFieldView, AssetView } from './types';

const { Paragraph, Text, Title } = Typography;
const ASSET_DETAIL_SIDEBAR_VIRTUALIZATION_THRESHOLD = 40;
const ASSET_DETAIL_SIDEBAR_ITEM_ESTIMATED_HEIGHT = 92;
const ASSET_DETAIL_SIDEBAR_VIRTUAL_OVERSCAN = 4;
const ASSET_DETAIL_FIELD_TABLE_PAGINATION_THRESHOLD = 120;
const ASSET_DETAIL_FIELD_TABLE_PAGE_SIZE = 80;

const FIELD_FILTER_OPTIONS: Array<{
  key: KnowledgeDetailFieldFilter;
  label: string;
}> = [
  { key: 'all', label: '全部字段' },
  { key: 'primary', label: '主键' },
  { key: 'calculated', label: '计算字段' },
  { key: 'noted', label: '有备注' },
];

type AssetDetailModalProps = {
  detailAsset: AssetView | null;
  activeDetailAsset: AssetView | null;
  detailAssets: AssetView[];
  detailTab: 'overview' | 'fields' | 'usage';
  detailFieldKeyword: string;
  detailFieldFilter: KnowledgeDetailFieldFilter;
  detailAssetFields: AssetDetailFieldRow[];
  onClose: () => void;
  onOpenAssetDetail: (asset: AssetView) => void;
  onNavigateModeling: () => void;
  onCopyAssetOverview: (asset: AssetView) => Promise<void> | void;
  onChangeDetailTab: (tab: 'overview' | 'fields' | 'usage') => void;
  onChangeFieldKeyword: (keyword: string) => void;
  onChangeFieldFilter: (filter: KnowledgeDetailFieldFilter) => void;
};

type AssetDetailFieldRow = {
  key?: string;
  fieldName: string;
  fieldType?: string | null;
  aiName?: string | null;
  example?: string | null;
  enumValue?: string | null;
  note?: string | null;
  sourceColumnName?: string | null;
  isPrimaryKey?: boolean;
  isCalculated?: boolean;
  aggregation?: string | null;
  lineage?: number[] | null;
  nestedFields?: AssetFieldView['nestedFields'];
};

function AssetDetailModal({
  detailAsset,
  activeDetailAsset,
  detailAssets,
  detailTab,
  detailFieldKeyword,
  detailFieldFilter,
  detailAssetFields,
  onClose,
  onOpenAssetDetail,
  onNavigateModeling,
  onCopyAssetOverview,
  onChangeDetailTab,
  onChangeFieldKeyword,
  onChangeFieldFilter,
}: AssetDetailModalProps) {
  const sidebarViewportRef = useRef<HTMLDivElement | null>(null);
  const [sidebarScrollTop, setSidebarScrollTop] = useState(0);
  const [sidebarViewportHeight, setSidebarViewportHeight] = useState(0);
  const shouldVirtualizeSidebar =
    detailAssets.length >= ASSET_DETAIL_SIDEBAR_VIRTUALIZATION_THRESHOLD;

  useEffect(() => {
    if (!shouldVirtualizeSidebar) {
      setSidebarScrollTop(0);
      return;
    }

    const viewport = sidebarViewportRef.current;
    if (!viewport) {
      return;
    }

    const measureViewport = () => {
      setSidebarViewportHeight(viewport.clientHeight);
    };

    measureViewport();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      measureViewport();
    });
    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, [detailAssets.length, shouldVirtualizeSidebar]);

  useEffect(() => {
    if (!detailAsset || !sidebarViewportRef.current) {
      return;
    }

    sidebarViewportRef.current.scrollTop = 0;
    setSidebarScrollTop(0);
  }, [detailAsset?.id]);
  useEffect(() => {
    if (!shouldVirtualizeSidebar || !activeDetailAsset) {
      return;
    }

    const viewport = sidebarViewportRef.current;
    if (!viewport) {
      return;
    }

    const activeIndex = detailAssets.findIndex(
      (asset) => asset.id === activeDetailAsset.id,
    );
    if (activeIndex < 0) {
      return;
    }

    const itemTop = activeIndex * ASSET_DETAIL_SIDEBAR_ITEM_ESTIMATED_HEIGHT;
    const itemBottom = itemTop + ASSET_DETAIL_SIDEBAR_ITEM_ESTIMATED_HEIGHT;
    const viewportTop = viewport.scrollTop;
    const viewportBottom = viewportTop + viewport.clientHeight;

    let nextScrollTop = viewportTop;
    if (itemTop < viewportTop) {
      nextScrollTop = itemTop;
    } else if (itemBottom > viewportBottom) {
      nextScrollTop = Math.max(0, itemBottom - viewport.clientHeight);
    }

    if (nextScrollTop !== viewportTop) {
      viewport.scrollTop = nextScrollTop;
      setSidebarScrollTop(nextScrollTop);
    }
  }, [activeDetailAsset?.id, detailAssets, shouldVirtualizeSidebar]);

  const sidebarVirtualWindow = useMemo(() => {
    if (!shouldVirtualizeSidebar) {
      return {
        startIndex: 0,
        endIndex: detailAssets.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const viewportHeight = Math.max(
      sidebarViewportHeight,
      ASSET_DETAIL_SIDEBAR_ITEM_ESTIMATED_HEIGHT,
    );
    const visibleCount = Math.max(
      1,
      Math.ceil(viewportHeight / ASSET_DETAIL_SIDEBAR_ITEM_ESTIMATED_HEIGHT),
    );
    const startIndex = Math.max(
      0,
      Math.floor(
        sidebarScrollTop / ASSET_DETAIL_SIDEBAR_ITEM_ESTIMATED_HEIGHT,
      ) - ASSET_DETAIL_SIDEBAR_VIRTUAL_OVERSCAN,
    );
    const endIndex = Math.min(
      detailAssets.length,
      startIndex + visibleCount + ASSET_DETAIL_SIDEBAR_VIRTUAL_OVERSCAN * 2,
    );

    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * ASSET_DETAIL_SIDEBAR_ITEM_ESTIMATED_HEIGHT,
      bottomSpacerHeight:
        (detailAssets.length - endIndex) *
        ASSET_DETAIL_SIDEBAR_ITEM_ESTIMATED_HEIGHT,
    };
  }, [
    detailAssets.length,
    shouldVirtualizeSidebar,
    sidebarScrollTop,
    sidebarViewportHeight,
  ]);

  const visibleDetailAssets = useMemo(
    () =>
      detailAssets.slice(
        sidebarVirtualWindow.startIndex,
        sidebarVirtualWindow.endIndex,
      ),
    [
      detailAssets,
      sidebarVirtualWindow.endIndex,
      sidebarVirtualWindow.startIndex,
    ],
  );

  const handleSidebarScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!shouldVirtualizeSidebar) {
        return;
      }
      setSidebarScrollTop(event.currentTarget.scrollTop);
    },
    [shouldVirtualizeSidebar],
  );

  const fieldTablePagination = useMemo(() => {
    if (
      detailAssetFields.length <= ASSET_DETAIL_FIELD_TABLE_PAGINATION_THRESHOLD
    ) {
      return false;
    }

    return {
      pageSize: ASSET_DETAIL_FIELD_TABLE_PAGE_SIZE,
      showSizeChanger: false,
      size: 'small' as const,
    };
  }, [detailAssetFields.length]);

  return (
    <ReferenceModal
      visible={Boolean(detailAsset)}
      title={null}
      footer={null}
      closable={false}
      onCancel={onClose}
      width={1280}
    >
      {activeDetailAsset && (
        <ModalPanel>
          <AssetDetailModalBody>
            <AssetDetailSidebar>
              <div>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  资产目录
                </Text>
                <Title level={4} style={{ margin: '6px 0 4px', fontSize: 22 }}>
                  当前知识库资产
                </Title>
                <Text type="secondary">
                  在同一抽屉内切换资产，保持知识库上下文不跳页。
                </Text>
              </div>
              <AssetDetailSidebarList
                ref={sidebarViewportRef}
                onScroll={handleSidebarScroll}
              >
                {shouldVirtualizeSidebar &&
                sidebarVirtualWindow.topSpacerHeight > 0 ? (
                  <div
                    style={{ height: sidebarVirtualWindow.topSpacerHeight }}
                    aria-hidden
                  />
                ) : null}
                {visibleDetailAssets.map((asset) => (
                  <AssetDetailSidebarItem
                    key={asset.id}
                    type="button"
                    $active={asset.id === activeDetailAsset.id}
                    onClick={() => onOpenAssetDetail(asset)}
                  >
                    <Space
                      direction="vertical"
                      size={6}
                      style={{ width: '100%' }}
                    >
                      <Space align="center" size={8} wrap>
                        <Text
                          strong
                          style={{ color: 'var(--nova-text-primary)' }}
                        >
                          {asset.name}
                        </Text>
                        <Tag
                          color={asset.kind === 'model' ? 'blue' : 'purple'}
                          style={{ marginInlineEnd: 0 }}
                        >
                          {asset.kind === 'model' ? '数据表' : '视图'}
                        </Tag>
                      </Space>
                      <Text type="secondary">
                        {asset.fieldCount} 个字段
                        {asset.relationCount
                          ? ` · ${asset.relationCount} 个关系`
                          : ''}
                      </Text>
                    </Space>
                  </AssetDetailSidebarItem>
                ))}
                {shouldVirtualizeSidebar &&
                sidebarVirtualWindow.bottomSpacerHeight > 0 ? (
                  <div
                    style={{ height: sidebarVirtualWindow.bottomSpacerHeight }}
                    aria-hidden
                  />
                ) : null}
              </AssetDetailSidebarList>
            </AssetDetailSidebar>

            <AssetDetailMain>
              <AssetDetailHero>
                <AssetDetailHead>
                  <div style={{ minWidth: 0 }}>
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      资产详情
                    </Text>
                    <ModalTitle style={{ fontSize: 22, marginTop: 6 }}>
                      {activeDetailAsset.name}
                    </ModalTitle>
                    <Paragraph style={{ margin: '10px 0 0', lineHeight: 1.8 }}>
                      {activeDetailAsset.description || '暂无资产说明'}
                    </Paragraph>
                    <AssetDetailMetaPills>
                      <AssetDetailMetaPill>
                        字段数 {activeDetailAsset.fieldCount}
                      </AssetDetailMetaPill>
                      <AssetDetailMetaPill>
                        类型{' '}
                        {activeDetailAsset.kind === 'model' ? '数据表' : '视图'}
                      </AssetDetailMetaPill>
                      <AssetDetailMetaPill>
                        创建人 {activeDetailAsset.owner || '工作区成员'}
                      </AssetDetailMetaPill>
                      <AssetDetailMetaPill>
                        {activeDetailAsset.cached ? '已缓存' : '未缓存'}
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
                      onClick={() =>
                        void onCopyAssetOverview(activeDetailAsset)
                      }
                      title="复制资产概览"
                    >
                      <CopyOutlined />
                    </AssetDetailIconButton>
                    <ModalCloseButton type="button" onClick={onClose}>
                      <CloseOutlined />
                    </ModalCloseButton>
                  </AssetDetailToolbar>
                </AssetDetailHead>
              </AssetDetailHero>

              <AssetDetailTabs>
                <AssetDetailTab
                  type="button"
                  $active={detailTab === 'overview'}
                  onClick={() => onChangeDetailTab('overview')}
                >
                  概览
                </AssetDetailTab>
                <AssetDetailTab
                  type="button"
                  $active={detailTab === 'fields'}
                  onClick={() => onChangeDetailTab('fields')}
                >
                  字段
                </AssetDetailTab>
                <AssetDetailTab
                  type="button"
                  $active={detailTab === 'usage'}
                  onClick={() => onChangeDetailTab('usage')}
                >
                  推荐问法
                </AssetDetailTab>
              </AssetDetailTabs>

              {detailTab === 'overview' ? (
                <>
                  <AssetDetailSummaryGrid>
                    <AssetDetailSummaryCard>
                      <Text type="secondary">主键 / 标识</Text>
                      <Title level={4} style={{ margin: '8px 0 0' }}>
                        {activeDetailAsset.primaryKey || '未声明'}
                      </Title>
                    </AssetDetailSummaryCard>
                    <AssetDetailSummaryCard>
                      <Text type="secondary">关系字段</Text>
                      <Title level={4} style={{ margin: '8px 0 0' }}>
                        {activeDetailAsset.relationCount || 0}
                      </Title>
                    </AssetDetailSummaryCard>
                    <AssetDetailSummaryCard>
                      <Text type="secondary">嵌套字段</Text>
                      <Title level={4} style={{ margin: '8px 0 0' }}>
                        {activeDetailAsset.nestedFieldCount || 0}
                      </Title>
                    </AssetDetailSummaryCard>
                    <AssetDetailSummaryCard>
                      <Text type="secondary">最近刷新</Text>
                      <Title level={4} style={{ margin: '8px 0 0' }}>
                        {activeDetailAsset.refreshTime || '未记录'}
                      </Title>
                    </AssetDetailSummaryCard>
                  </AssetDetailSummaryGrid>

                  <AssetDetailSection>
                    <Space
                      direction="vertical"
                      size={10}
                      style={{ width: '100%' }}
                    >
                      <Text strong>数据来源</Text>
                      <Text type="secondary">
                        {activeDetailAsset.sourceTableName
                          ? `来源表 / 主题：${activeDetailAsset.sourceTableName}`
                          : '当前资产未暴露源表名称。'}
                      </Text>
                      {activeDetailAsset.sourceSql ? (
                        <AssetDetailSqlPreview>
                          {activeDetailAsset.sourceSql}
                        </AssetDetailSqlPreview>
                      ) : (
                        <Text type="secondary">
                          当前资产没有可直接展示的 SQL / 语句定义。
                        </Text>
                      )}
                    </Space>
                  </AssetDetailSection>

                  <AssetDetailSection>
                    <Space
                      direction="vertical"
                      size={10}
                      style={{ width: '100%' }}
                    >
                      <Text strong>关系与使用说明</Text>
                      {activeDetailAsset.relationFields?.length ? (
                        <Space size={[8, 8]} wrap>
                          {activeDetailAsset.relationFields.map((relation) => (
                            <Tag
                              key={relation.key}
                              style={{
                                marginInlineEnd: 0,
                                borderRadius: 999,
                                paddingInline: 10,
                              }}
                            >
                              {relation.displayName}
                              {relation.modelName
                                ? ` → ${relation.modelName}`
                                : ''}
                            </Tag>
                          ))}
                        </Space>
                      ) : (
                        <Text type="secondary">
                          当前资产暂未声明关系字段，可继续在建模页补齐关系。
                        </Text>
                      )}
                    </Space>
                  </AssetDetailSection>
                </>
              ) : null}

              {detailTab === 'fields' ? (
                <>
                  <AssetDetailSection>
                    <AssetDetailFilterRow>
                      <Input.Search
                        allowClear
                        placeholder="搜索字段名、AI 名称、类型、备注"
                        value={detailFieldKeyword}
                        onChange={(event) =>
                          onChangeFieldKeyword(event.target.value)
                        }
                        style={{ maxWidth: 360 }}
                      />
                      <AssetDetailFilterPills>
                        {FIELD_FILTER_OPTIONS.map((filter) => (
                          <AssetDetailFilterPill
                            key={filter.key}
                            type="button"
                            $active={detailFieldFilter === filter.key}
                            onClick={() => onChangeFieldFilter(filter.key)}
                          >
                            {filter.label}
                          </AssetDetailFilterPill>
                        ))}
                      </AssetDetailFilterPills>
                    </AssetDetailFilterRow>
                  </AssetDetailSection>

                  <AssetDetailTableWrap>
                    <Table
                      rowKey={(field) => field.key || field.fieldName}
                      pagination={fieldTablePagination}
                      scroll={{ y: 500 }}
                      dataSource={detailAssetFields}
                      columns={[
                        {
                          title: '字段',
                          key: 'field',
                          width: 240,
                          render: (_value, field: AssetDetailFieldRow) => (
                            <Space
                              direction="vertical"
                              size={6}
                              style={{ width: '100%' }}
                            >
                              <Text strong>
                                {field.aiName || field.fieldName}
                              </Text>
                              <Text type="secondary">{field.fieldName}</Text>
                              <Space size={[6, 6]} wrap>
                                {field.isPrimaryKey ? (
                                  <Tag color="purple">主键</Tag>
                                ) : null}
                                {field.isCalculated ? (
                                  <Tag color="blue">计算字段</Tag>
                                ) : null}
                                {field.nestedFields?.length ? (
                                  <Tag color="gold">
                                    嵌套 {field.nestedFields.length}
                                  </Tag>
                                ) : null}
                              </Space>
                            </Space>
                          ),
                        },
                        {
                          title: '类型',
                          dataIndex: 'fieldType',
                          width: 120,
                          render: (value) => value || '未知',
                        },
                        {
                          title: '来源',
                          key: 'source',
                          width: 220,
                          render: (_value, field: AssetDetailFieldRow) =>
                            field.sourceColumnName ||
                            field.example ||
                            (field.isCalculated ? '表达式字段' : '—'),
                        },
                        {
                          title: '枚举 / 聚合',
                          key: 'enum',
                          width: 160,
                          render: (_value, field: AssetDetailFieldRow) =>
                            field.enumValue ||
                            field.aggregation || (
                              <AssetDetailEmptyPill>暂无</AssetDetailEmptyPill>
                            ),
                        },
                        {
                          title: '字段备注',
                          dataIndex: 'note',
                          render: (value, field: AssetDetailFieldRow) => (
                            <Space direction="vertical" size={4}>
                              <span>{value || '暂无'}</span>
                              {field.lineage?.length ? (
                                <Text type="secondary">
                                  lineage: {field.lineage.join(' → ')}
                                </Text>
                              ) : null}
                            </Space>
                          ),
                        },
                      ]}
                    />
                  </AssetDetailTableWrap>
                </>
              ) : null}

              {detailTab === 'usage' ? (
                <>
                  <AssetDetailSection>
                    <Space
                      direction="vertical"
                      size={10}
                      style={{ width: '100%' }}
                    >
                      <Text strong>推荐问法</Text>
                      <AssetDetailQuestionList>
                        {(activeDetailAsset.suggestedQuestions || []).map(
                          (question) => (
                            <li key={question}>{question}</li>
                          ),
                        )}
                      </AssetDetailQuestionList>
                    </Space>
                  </AssetDetailSection>
                  <AssetDetailSection>
                    <Space
                      direction="vertical"
                      size={10}
                      style={{ width: '100%' }}
                    >
                      <Text strong>使用建议</Text>
                      <AssetDetailQuestionList>
                        <li>
                          先确认主键、口径字段和时间字段是否完整，再开放给问答线程使用。
                        </li>
                        <li>
                          如果这是视图，建议同时在 SQL
                          模板页沉淀典型查询口径，提升问答稳定性。
                        </li>
                        <li>
                          如果关联字段仍为空，可前往建模页补齐关系，减少跨主题问答歧义。
                        </li>
                      </AssetDetailQuestionList>
                    </Space>
                  </AssetDetailSection>
                </>
              ) : null}
            </AssetDetailMain>
          </AssetDetailModalBody>
        </ModalPanel>
      )}
    </ReferenceModal>
  );
}

export default memo(AssetDetailModal);
