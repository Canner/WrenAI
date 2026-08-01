import { Table } from 'antd';
import type { TableProps } from 'antd';

/**
 * Thin wrapper over AntD Table with the project defaults (compact, horizontal
 * scroll, sensible pagination). Generic over the row type.
 */
export function DataTable<RecordType extends object>(props: TableProps<RecordType>) {
  return (
    <Table<RecordType>
      size="small"
      scroll={{ x: 'max-content' }}
      pagination={props.pagination ?? { pageSize: 10, hideOnSinglePage: true }}
      {...props}
    />
  );
}
