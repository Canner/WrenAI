import React from 'react';
import styled from 'styled-components';
import { Table, Transfer, Tag } from 'antd';
import type { TableColumnsType, TableProps, TransferProps } from 'antd';
import type { TransferItem } from 'antd/es/transfer';
import difference from 'lodash/difference';

export type TableTransferRecord = TransferItem & {
  disabled?: boolean;
  title?: React.ReactNode;
  [key: string]: any;
};

const TypedTable = Table<TableTransferRecord>;

const StyledTable = styled(TypedTable)`
  .ant-table-row {
    cursor: pointer;
  }
  .ant-table-row-disabled {
    cursor: not-allowed;
    color: var(--gray-5);
    .ant-tag {
      color: var(--gray-5);
    }
  }
`;

export const defaultColumns: TableColumnsType<TableTransferRecord> = [
  {
    dataIndex: 'name',
    title: '字段名称',
  },
  {
    dataIndex: 'type',
    title: '字段类型',
    render: (type: string) => <Tag>{type.toUpperCase()}</Tag>,
  },
];

interface TableTransferProps extends TransferProps<TableTransferRecord> {
  dataSource: TableTransferRecord[];
  leftColumns?: TableColumnsType<TableTransferRecord>;
  rightColumns?: TableColumnsType<TableTransferRecord>;
}

const TableTransfer = (
  {
    leftColumns = defaultColumns,
    rightColumns = defaultColumns,
    ...restProps
  }: TableTransferProps,
  ref: React.ForwardedRef<HTMLDivElement>,
) => {
  return (
    <Transfer<TableTransferRecord>
      {...restProps}
      locale={{
        searchPlaceholder: '搜索字段',
        itemUnit: '项',
        itemsUnit: '项',
        notFoundContent: '暂无数据',
        ...restProps.locale,
      }}
      showSelectAll={false}
      listStyle={{ height: 332 }}
    >
      {({
        direction,
        filteredItems,
        onItemSelectAll,
        onItemSelect,
        selectedKeys: listSelectedKeys,
        disabled: listDisabled,
      }) => {
        const columns = direction === 'left' ? leftColumns : rightColumns;
        const tableItems = filteredItems as TableTransferRecord[];
        const shouldPaginate = tableItems.length > 120;

        const rowSelection: NonNullable<
          TableProps<TableTransferRecord>['rowSelection']
        > = {
          getCheckboxProps: (item) => ({
            disabled: listDisabled || item.disabled,
          }),
          onSelectAll(selected, selectedRows) {
            const treeSelectedKeys = selectedRows
              .filter((item) => !item.disabled)
              .map(({ key }) => key)
              .filter((key): key is string => typeof key === 'string');
            const diffKeys = selected
              ? difference(treeSelectedKeys, listSelectedKeys)
              : difference(listSelectedKeys, treeSelectedKeys);
            onItemSelectAll(diffKeys, selected);
          },
          onSelect({ key }, selected) {
            if (typeof key === 'string') {
              onItemSelect(key, selected);
            }
          },
          selectedRowKeys: listSelectedKeys,
        };

        return (
          <div ref={ref}>
            <StyledTable
              rowSelection={rowSelection}
              columns={columns}
              dataSource={tableItems}
              locale={{ emptyText: '暂无数据' }}
              size="small"
              style={{
                pointerEvents: listDisabled ? 'none' : undefined,
              }}
              onRow={({ key, disabled: itemDisabled, title }) => ({
                title,
                onClick: () => {
                  if (itemDisabled || listDisabled) {
                    return;
                  }
                  if (typeof key === 'string') {
                    onItemSelect(key, !listSelectedKeys.includes(key));
                  }
                },
              })}
              rowClassName={({ disabled: itemDisabled }) =>
                itemDisabled ? 'ant-table-row-disabled' : ''
              }
              scroll={{ y: 200 }}
              pagination={
                shouldPaginate
                  ? {
                      pageSize: 50,
                      showSizeChanger: false,
                      size: 'small',
                    }
                  : false
              }
            />
          </div>
        );
      }}
    </Transfer>
  );
};

export default React.forwardRef(TableTransfer);
