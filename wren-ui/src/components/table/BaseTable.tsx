import { useMemo } from 'react';
import { Table, TableProps, Row, Col } from 'antd';
import EllipsisWrapper from '@/components/EllipsisWrapper';
import CodeBlock from '@/components/editor/CodeBlock';
import { getColumnTypeIcon } from '@/utils/columnType';
import { ComposeDiagramField, getJoinTypeText } from '@/utils/data';
import { makeIterable } from '@/utils/iteration';

export const COLUMN = {
  DISPLAY_NAME: {
    title: 'Display name',
    dataIndex: 'displayName',
    key: 'displayName',
    width: 140,
    ellipsis: true,
    render: (name) => name || '-',
  },
  REFERENCE_NAME: {
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
      `${relation.fromModelName}.${relation.fromColumnName}`,
  },
  RELATION_TO: {
    title: 'To',
    key: 'toField',
    ellipsis: true,
    render: (relation) => `${relation.toModelName}.${relation.toColumnName}`,
  },
  RELATION: {
    title: 'Type',
    dataIndex: 'type',
    key: 'joinType',
    width: 130,
    render: (joinType) => getJoinTypeText(joinType),
  },
  DESCRIPTION: {
    title: 'Description',
    dataIndex: 'description',
    key: 'description',
    width: 200,
    ellipsis: true,
    render: (text) => text || '-',
  },
};

type BaseTableProps = TableProps<ComposeDiagramField>;

export type Props = BaseTableProps & {
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
      <Row wrap={false} className="py-1 px-4">
        <Col span={6} className="gray-6">
          {title}
        </Col>
        <Col>{value}</Col>
      </Row>
    </>
  );
});

export function ExpandableRows(props) {
  const { data } = props;
  return (
    <div className="pl-12 text-sm gray-8 -my-1">
      <ExpandableRowIterator data={data} />
    </div>
  );
}
