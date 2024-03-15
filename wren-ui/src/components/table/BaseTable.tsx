import { useMemo } from 'react';
import { Table, TableProps } from 'antd';
import EllipsisWrapper from '@/components/EllipsisWrapper';
import CodeBlock from '@/components/editor/CodeBlock';
import { getColumnTypeIcon } from '@/utils/columnType';
import { ModelColumnData, getJoinTypeText } from '@/utils/data';

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
    dataIndex: 'fromField',
    key: 'fromField',
    ellipsis: true,
    render: (fromField) => `${fromField.model}.${fromField.field}`,
  },
  RELATION_TO: {
    title: 'To',
    dataIndex: 'toField',
    key: 'toField',
    ellipsis: true,
    render: (toField) => `${toField.model}.${toField.field}`,
  },
  RELATION: {
    title: 'Relation type',
    dataIndex: 'joinType',
    key: 'joinType',
    width: 130,
    render: (joinType) => getJoinTypeText(joinType),
  },
  DESCRIPTION: {
    title: 'Description',
    dataIndex: ['properties', 'description'],
    key: 'description',
    width: 200,
    ellipsis: true,
    render: (text) => text || '-',
  },
};

type BaseTableProps = TableProps<ModelColumnData>;

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
