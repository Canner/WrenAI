import { Input, Table } from 'antd';
import type { KnowledgeDetailFieldFilter } from '@/hooks/useKnowledgeAssetDetail';
import {
  AssetDetailFilterPill,
  AssetDetailFilterPills,
  AssetDetailFilterRow,
  AssetDetailTableWrap,
  WorkbenchCompactChip,
} from '@/features/knowledgePage/index.styles';
import { buildAssetDetailFieldColumns } from './buildAssetDetailFieldColumns';
import type { AssetDetailFieldRow } from './assetDetailContentTypes';

const FIELD_FILTER_OPTIONS: Array<{
  key: KnowledgeDetailFieldFilter;
  label: string;
}> = [
  { key: 'all', label: '全部字段' },
  { key: 'primary', label: '主键' },
  { key: 'calculated', label: '计算字段' },
  { key: 'noted', label: '有备注' },
];

type AssetDetailFieldOverviewProps = {
  detailFieldKeyword: string;
  detailFieldFilter: KnowledgeDetailFieldFilter;
  detailAssetFields: AssetDetailFieldRow[];
  fieldGovernance: {
    primaryCount: number;
    notedCount: number;
    totalCount: number;
    calculatedCount: number;
    nestedCount: number;
  };
  onChangeFieldKeyword: (keyword: string) => void;
  onChangeFieldFilter: (filter: KnowledgeDetailFieldFilter) => void;
};

export default function AssetDetailFieldOverview({
  detailFieldKeyword,
  detailFieldFilter,
  detailAssetFields,
  fieldGovernance,
  onChangeFieldKeyword,
  onChangeFieldFilter,
}: AssetDetailFieldOverviewProps) {
  return (
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
          columns={buildAssetDetailFieldColumns()}
        />
      </AssetDetailTableWrap>
    </>
  );
}
