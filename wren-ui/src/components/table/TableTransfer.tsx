import React from 'react';
import styled from 'styled-components';
import { Table, Transfer, Tag } from 'antd';
import difference from 'lodash/difference';
import { TransferItem, TransferProps } from 'antd/es/transfer';
import { ColumnsType, TableRowSelection } from 'antd/es/table/interface';

const StyledTable = styled(Table)`
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

// default left and right columns
export const defaultColumns = [
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

interface TableTransferProps extends TransferProps<TransferItem> {
  dataSource: any[];
  leftColumns?: ColumnsType<any>;
  rightColumns?: ColumnsType<any>;
}

const TableTransfer = (
  {
    leftColumns = defaultColumns,
    rightColumns = defaultColumns,
    ...restProps
  }: TableTransferProps,
  ref: any,
) => {
  return (
    <Transfer
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
        const shouldPaginate = filteredItems.length > 120;

        const rowSelection: TableRowSelection<TransferItem> = {
          getCheckboxProps: (item) => ({
            disabled: listDisabled || item.disabled,
          }),
          onSelectAll(selected, selectedRows) {
            const treeSelectedKeys = selectedRows
              .filter((item) => !item.disabled)
              .map(({ key }) => key);
            const diffKeys = selected
              ? difference(treeSelectedKeys, listSelectedKeys)
              : difference(listSelectedKeys, treeSelectedKeys);
            onItemSelectAll(diffKeys as string[], selected);
          },
          onSelect({ key }, selected) {
            onItemSelect(key as string, selected);
          },
          selectedRowKeys: listSelectedKeys,
        };

        return (
          <div ref={ref}>
            <StyledTable
              rowSelection={rowSelection}
              columns={columns}
              dataSource={filteredItems}
              locale={{ emptyText: '暂无数据' }}
              size="small"
              style={
                {
                  pointerEvents: listDisabled ? 'none' : null,
                } as React.CSSProperties
              }
              onRow={({ key, disabled: itemDisabled, title }: any) => ({
                title,
                onClick: () => {
                  if (itemDisabled || listDisabled) return;
                  onItemSelect(
                    key as string,
                    !listSelectedKeys.includes(key as string),
                  );
                },
              })}
              rowClassName={({ disabled: itemDisabled }: any) =>
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
