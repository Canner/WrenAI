import { ReactNode, useMemo } from 'react';
import { Table, TableProps, Row, Col } from 'antd';
import EllipsisWrapper from '@/components/EllipsisWrapper';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
import { getColumnTypeIcon } from '@/utils/columnType';
import { ComposeDiagramField, getJoinTypeText } from '@/utils/data';
import { makeIterable } from '@/utils/iteration';

export const COLUMN = {
  ALIAS: {
    title: '显示名称',
    dataIndex: 'displayName',
    key: 'alias',
    ellipsis: true,
    render: (name: string | null | undefined) => name || '-',
  },
  NAME: {
    title: '名称',
    dataIndex: 'referenceName',
    key: 'referenceName',
    ellipsis: true,
    render: (name: string | null | undefined) => name || '-',
  },
  TYPE: {
    title: '类型',
    dataIndex: 'type',
    render: (type: string | null | undefined) => {
      return (
        <div className="d-flex align-center">
          {getColumnTypeIcon({ type: type || '' }, { className: 'mr-2' })}
          {type}
        </div>
      );
    },
  },
  EXPRESSION: {
    title: '表达式',
    dataIndex: 'expression',
    key: 'expression',
    render: (expression: string | null | undefined) => {
      const code = expression || '';
      return (
        <EllipsisWrapper text={code}>
          <SQLCodeBlock code={code} inline />
        </EllipsisWrapper>
      );
    },
  },
  RELATION_FROM: {
    title: '来源字段',
    key: 'fromField',
    ellipsis: true,
    render: (relation: Partial<ComposeDiagramField>) =>
      `${relation.fromModelDisplayName || ''}.${relation.fromColumnDisplayName || ''}`,
  },
  RELATION_TO: {
    title: '目标字段',
    key: 'toField',
    ellipsis: true,
    render: (relation: Partial<ComposeDiagramField>) =>
      `${relation.toModelDisplayName || ''}.${relation.toColumnDisplayName || ''}`,
  },
  RELATION: {
    title: '关系类型',
    dataIndex: 'type',
    key: 'joinType',
    render: (joinType: string | null | undefined) =>
      getJoinTypeText((joinType || '') as never),
  },
  DESCRIPTION: {
    title: '描述',
    dataIndex: 'description',
    key: 'description',
    ellipsis: true,
    render: (text: string | null | undefined) => text || '-',
  },
};

type BaseTableProps = TableProps<ComposeDiagramField>;

export type Props = BaseTableProps & {
  showExpandable?: boolean;
  actionColumns?: BaseTableProps['columns'];
};

export default function BaseTable(props: Props) {
  const { dataSource = [], columns = [], actionColumns, ...restProps } = props;

  const tableColumns = useMemo(
    () => columns.concat(actionColumns || []),
    [dataSource],
  );

  const tableData = useMemo(
    () =>
      (dataSource || []).map((record, index) => ({
        ...record,
        key: `${record.id}-${index}`,
      })),
    [dataSource],
  );

  return (
    <Table
      {...restProps}
      dataSource={tableData}
      showHeader={tableData.length > 0}
      columns={tableColumns}
      locale={{ emptyText: '暂无数据', ...restProps.locale }}
      pagination={{
        hideOnSinglePage: true,
        pageSize: 10,
        size: 'small',
      }}
    />
  );
}

type ExpandableRowItem = {
  title: ReactNode;
  value: ReactNode;
};

const ExpandableRowIterator = makeIterable(
  (props: ExpandableRowItem & { index: number }) => {
    const { title, value, index } = props;
    return (
      <>
        {index > 0 && <div className="border-b border-gray-5" />}
        <Row wrap={false} className="py-1 px-2">
          <Col span={6} className="gray-6">
            {title}
          </Col>
          <Col style={{ wordBreak: 'break-word' }}>{value}</Col>
        </Row>
      </>
    );
  },
);

export function ExpandableRows(props: {
  data: ExpandableRowItem[];
  extra?: ReactNode;
}) {
  const { data, extra } = props;
  return (
    <div className="pl-12 text-sm gray-8 -my-1">
      <ExpandableRowIterator data={data} />
      {extra}
    </div>
  );
}
