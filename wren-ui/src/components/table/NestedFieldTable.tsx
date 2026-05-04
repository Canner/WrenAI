import { COLUMN } from '@/components/table/BaseTable';
import { Table, TableProps } from 'antd';
import { DiagramModelNestedField } from '@/apollo/client/graphql/__types__';

type Props = TableProps<DiagramModelNestedField>;

export default function NestedFieldTable(props: Props) {
  const { columns } = props;
  return (
    <Table
      {...props}
      columns={
        columns || [
          { ...COLUMN.NAME, width: 70 },
          { ...COLUMN.ALIAS, width: 70 },
          { ...COLUMN.TYPE, width: 45 },
          { ...COLUMN.DESCRIPTION, width: 80 },
        ]
      }
      className="ant-table--text-sm ml-2"
      scroll={{ x: 600 }}
      size="small"
      pagination={{
        hideOnSinglePage: true,
        size: 'small',
        pageSize: 10,
      }}
    />
  );
}
