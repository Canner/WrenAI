import { Space, Tag, Typography } from 'antd';
import { AssetDetailEmptyPill } from '@/features/knowledgePage/index.styles';
import type { AssetDetailFieldRow } from './assetDetailContentTypes';

const { Text } = Typography;

export function buildAssetDetailFieldColumns() {
  return [
    {
      title: '字段',
      key: 'field',
      width: 260,
      render: (_value: unknown, field: AssetDetailFieldRow) => (
        <Space direction="vertical" size={1} style={{ width: '100%' }}>
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
      render: (value: string | null | undefined) => value || '未知',
    },
    {
      title: '来源',
      key: 'source',
      width: 180,
      render: (_value: unknown, field: AssetDetailFieldRow) =>
        field.sourceColumnName ||
        field.example ||
        (field.isCalculated ? '表达式字段' : '—'),
    },
    {
      title: '枚举 / 聚合',
      key: 'enum',
      width: 130,
      render: (_value: unknown, field: AssetDetailFieldRow) =>
        field.enumValue ||
        field.aggregation || <AssetDetailEmptyPill>暂无</AssetDetailEmptyPill>,
    },
    {
      title: '字段备注',
      dataIndex: 'note',
      render: (
        value: string | null | undefined,
        field: AssetDetailFieldRow,
      ) => (
        <Space direction="vertical" size={1}>
          <span style={{ lineHeight: 1.35 }}>{value || '暂无'}</span>
          {field.lineage?.length ? (
            <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.3 }}>
              lineage: {field.lineage.join(' → ')}
            </Text>
          ) : null}
        </Space>
      ),
    },
  ];
}
