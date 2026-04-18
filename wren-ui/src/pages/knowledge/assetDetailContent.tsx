import { memo, type ReactNode, useEffect } from 'react';
import { Button, Input, Space, Table, Tag, Typography } from 'antd';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
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
  AssetDetailQuestionList,
  AssetDetailTableWrap,
  AssetDetailTab,
  AssetDetailTabs,
  AssetDetailToolbar,
  LightButton,
  WorkbenchCompactChip,
  WorkbenchCompactPanel,
  WorkbenchCompactPanelTitle,
} from '@/features/knowledgePage/index.styles';
import type { AssetFieldView, AssetView } from '@/features/knowledgePage/types';
import { summarizeAssetFieldGovernance } from '@/utils/knowledgeWorkbenchEditor';

const { Paragraph, Text, Title } = Typography;

const FIELD_FILTER_OPTIONS: Array<{
  key: KnowledgeDetailFieldFilter;
  label: string;
}> = [
  { key: 'all', label: '全部字段' },
  { key: 'primary', label: '主键' },
  { key: 'calculated', label: '计算字段' },
  { key: 'noted', label: '有备注' },
];

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
        <>
          <div style={{ marginTop: 12 }}>
            <AssetDetailFilterRow>
              <Input.Search
                allowClear
                placeholder="搜索字段名、AI 名称、类型、备注"
                value={detailFieldKeyword}
                onChange={(event) => onChangeFieldKeyword(event.target.value)}
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
                <WorkbenchCompactChip
                  $tone={fieldGovernance.primaryCount ? 'accent' : 'default'}
                  style={{ minHeight: 20, padding: '0 7px', fontSize: 10 }}
                >
                  {fieldGovernance.primaryCount
                    ? `主键 ${fieldGovernance.primaryCount}`
                    : '主键未声明'}
                </WorkbenchCompactChip>
                <WorkbenchCompactChip
                  style={{ minHeight: 20, padding: '0 7px', fontSize: 10 }}
                >
                  备注 {fieldGovernance.notedCount}/{fieldGovernance.totalCount}
                </WorkbenchCompactChip>
                <WorkbenchCompactChip
                  style={{ minHeight: 20, padding: '0 7px', fontSize: 10 }}
                >
                  计算 {fieldGovernance.calculatedCount}
                </WorkbenchCompactChip>
                <WorkbenchCompactChip
                  style={{ minHeight: 20, padding: '0 7px', fontSize: 10 }}
                >
                  嵌套 {fieldGovernance.nestedCount}
                </WorkbenchCompactChip>
              </AssetDetailFilterPills>
            </AssetDetailFilterRow>
          </div>
          <AssetDetailTableWrap>
            <Table
              size="small"
              rowKey={(field) => field.key || field.fieldName}
              pagination={false}
              scroll={{ y: 560 }}
              dataSource={detailAssetFields}
              columns={[
                {
                  title: '字段',
                  key: 'field',
                  width: 260,
                  render: (_value, field: AssetDetailFieldRow) => (
                    <Space
                      direction="vertical"
                      size={1}
                      style={{ width: '100%' }}
                    >
                      <Text strong style={{ lineHeight: 1.3, fontSize: 12 }}>
                        {field.aiName || field.fieldName}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {field.fieldName}
                      </Text>
                      <Space size={[3, 3]} wrap>
                        {field.isPrimaryKey ? (
                          <Tag
                            color="purple"
                            style={{
                              marginRight: 0,
                              fontSize: 10,
                              lineHeight: 1.15,
                            }}
                          >
                            主键
                          </Tag>
                        ) : null}
                        {field.isCalculated ? (
                          <Tag
                            color="blue"
                            style={{
                              marginRight: 0,
                              fontSize: 10,
                              lineHeight: 1.15,
                            }}
                          >
                            计算字段
                          </Tag>
                        ) : null}
                        {field.nestedFields?.length ? (
                          <Tag
                            color="gold"
                            style={{
                              marginRight: 0,
                              fontSize: 10,
                              lineHeight: 1.15,
                            }}
                          >
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
                  width: 110,
                  render: (value) => value || '未知',
                },
                {
                  title: '来源',
                  key: 'source',
                  width: 180,
                  render: (_value, field: AssetDetailFieldRow) =>
                    field.sourceColumnName ||
                    field.example ||
                    (field.isCalculated ? '表达式字段' : '—'),
                },
                {
                  title: '枚举 / 聚合',
                  key: 'enum',
                  width: 130,
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
                    <Space direction="vertical" size={1}>
                      <span style={{ lineHeight: 1.35 }}>
                        {value || '暂无'}
                      </span>
                      {field.lineage?.length ? (
                        <Text
                          type="secondary"
                          style={{ fontSize: 11, lineHeight: 1.3 }}
                        >
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

      {effectiveDetailTab === 'usage' ? (
        <>
          <WorkbenchCompactPanel style={{ padding: '14px 16px' }}>
            <WorkbenchCompactPanelTitle style={{ marginBottom: 8 }}>
              推荐问法
            </WorkbenchCompactPanelTitle>
            {(activeDetailAsset.suggestedQuestions || []).length ? (
              <AssetDetailQuestionList>
                {(activeDetailAsset.suggestedQuestions || []).map(
                  (question) => (
                    <li key={question}>{question}</li>
                  ),
                )}
              </AssetDetailQuestionList>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                当前资产还没有推荐问法，可在后续问答中逐步沉淀。
              </Text>
            )}
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: '1px solid #eef2f7',
              }}
            >
              <Text
                strong
                style={{ display: 'block', marginBottom: 8, fontSize: 13 }}
              >
                使用建议
              </Text>
              <AssetDetailQuestionList style={{ marginBottom: 0 }}>
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
              {canCreateKnowledgeArtifacts ? (
                <Space size={8} wrap style={{ marginTop: 12 }}>
                  <LightButton
                    onClick={() =>
                      void onCreateSqlTemplateDraft?.(activeDetailAsset)
                    }
                  >
                    新建 SQL 模板
                  </LightButton>
                  <LightButton
                    onClick={() => void onCreateRuleDraft?.(activeDetailAsset)}
                  >
                    新建分析规则
                  </LightButton>
                </Space>
              ) : null}
            </div>
          </WorkbenchCompactPanel>
        </>
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
