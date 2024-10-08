import { useMemo } from 'react';
import { Table, TableProps, Row, Col } from 'antd';
import EllipsisWrapper from '@/components/EllipsisWrapper';
import CodeBlock from '@/components/editor/CodeBlock';
import { getColumnTypeIcon } from '@/utils/columnType';
import { ComposeDiagramField, getJoinTypeText } from '@/utils/data';
import { makeIterable } from '@/utils/iteration';

export const COLUMN = {
  ALIAS: {
    title: 'Alias',
    dataIndex: 'displayName',
    key: 'alias',
    ellipsis: true,
    render: (name) => name || '-',
  },
  NAME: {
    title: 'Name',
    dataIndex: 'referenceName',
    key: 'referenceName',
    ellipsis: true,
    render: (name) => name || '-',
  },
  TYPE: {
    title: 'Type',
    dataIndex: 'type',
    render: (type) => {
      return (
        <div className="d-flex align-center">
          {getColumnTypeIcon({ type }, { className: 'mr-2' })}
          {type}
        </div>
      );
    },
  },
  EXPRESSION: {
    title: 'Expression',
    dataIndex: 'expression',
    key: 'expression',
    render: (expression) => {
      return (
        <EllipsisWrapper text={expression}>
          <CodeBlock code={expression} inline />
        </EllipsisWrapper>
      );
    },
  },
  RELATION_FROM: {
    title: 'From',
    key: 'fromField',
    ellipsis: true,
    render: (relation) =>
      `${relation.fromModelDisplayName}.${relation.fromColumnDisplayName}`,
  },
  RELATION_TO: {
    title: 'To',
    key: 'toField',
    ellipsis: true,
    render: (relation) =>
      `${relation.toModelDisplayName}.${relation.toColumnDisplayName}`,
  },
  RELATION: {
    title: 'Type',
    dataIndex: 'type',
    key: 'joinType',
    render: (joinType) => getJoinTypeText(joinType),
  },
  DESCRIPTION: {
    title: 'Description',
    dataIndex: 'description',
    key: 'description',
    ellipsis: true,
    render: (text) => text || '-',
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
      pagination={{
        hideOnSinglePage: true,
        pageSize: 10,
        size: 'small',
      }}
    />
  );
}

const ExpandableRowIterator = makeIterable((props) => {
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
});

export function ExpandableRows(props) {
  const { data, extra } = props;
  return (
    <div className="pl-12 text-sm gray-8 -my-1">
      <ExpandableRowIterator data={data} />
      {extra}
    </div>
  );
}
