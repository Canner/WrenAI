import { useState, useMemo, type ChangeEvent } from 'react';
import styled from 'styled-components';
import { isString } from 'lodash';
import { Form, Input, Table } from 'antd';
import type { TableColumnsType } from 'antd';
import SearchOutlined from '@ant-design/icons/SearchOutlined';

const StyledBox = styled.div`
  border: 1px solid var(--gray-5);
  border-radius: 4px;

  &.multiSelectBox-input-error {
    border-color: var(--red-5);
  }

  .ant-table {
    border: 0;
  }
  .ant-table-body,
  .ant-table-placeholder {
    height: 195px;
  }
`;

const StyledTotal = styled.div`
  padding: 8px 12px;
  border-bottom: 1px var(--gray-3) solid;
`;
const MULTI_SELECT_PAGINATION_THRESHOLD = 120;
const MULTI_SELECT_PAGE_SIZE = 50;

interface Props {
  columns: TableColumnsType<any>;
  loading: boolean;
  items: { [key: string]: any; value: string }[];
  value?: string[];
  onChange?: (value: string[]) => void;
}

export default function MultiSelectBox(props: Props) {
  const { columns, loading, items, onChange, value } = props;
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(
    new Set(value),
  );
  const [searchValue, setSearchValue] = useState<string>('');
  const { status } = Form.Item.useStatus();

  const dataSource = useMemo(() => {
    const getColumnValue = (item: Record<string, any>, column: any) => {
      if (!column || typeof column !== 'object' || !('dataIndex' in column)) {
        return undefined;
      }

      const dataIndex = column.dataIndex;
      if (Array.isArray(dataIndex)) {
        return dataIndex.reduce(
          (result, segment) =>
            result && typeof result === 'object' ? result[segment] : undefined,
          item as unknown,
        );
      }

      return typeof dataIndex === 'string' ? item[dataIndex] : undefined;
    };

    return searchValue
      ? items.filter((item) =>
          columns
            .map((column) => getColumnValue(item, column))
            .some((value) => isString(value) && value.includes(searchValue)),
        )
      : items;
  }, [items, searchValue]);

  const onSelect = (rowKey: string) => {
    const newSelectedRowKey = new Set(selectedRowKeys);
    if (newSelectedRowKey.has(rowKey)) {
      newSelectedRowKey.delete(rowKey);
    } else {
      newSelectedRowKey.add(rowKey);
    }
    setSelectedRowKeys(newSelectedRowKey);
    onChange && onChange(Array.from(newSelectedRowKey));
  };

  const onSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setSearchValue(value);
  };

  const total =
    selectedRowKeys.size === 0
      ? items.length
      : `${selectedRowKeys.size}/${items.length}`;
  const shouldPaginate = dataSource.length > MULTI_SELECT_PAGINATION_THRESHOLD;

  return (
    <StyledBox
      className={status ? `multiSelectBox-input-${status}` : undefined}
    >
      <StyledTotal>{total} 张数据表</StyledTotal>
      <div className="p-2">
        <Input
          prefix={<SearchOutlined />}
          onChange={onSearchChange}
          placeholder="搜索数据表"
          allowClear
        />
      </div>
      <Table
        rowSelection={{
          type: 'checkbox',
          preserveSelectedRowKeys: true,
          selectedRowKeys: Array.from(selectedRowKeys),
          onSelect: (record) => onSelect(record.value),
          onChange(keys) {
            const nextSelectedRowKeys = new Set(keys as string[]);
            setSelectedRowKeys(nextSelectedRowKeys);
            onChange && onChange(Array.from(nextSelectedRowKeys));
          },
        }}
        rowKey={(record) => record.value}
        columns={columns}
        dataSource={dataSource}
        scroll={{ y: 195 }}
        pagination={
          shouldPaginate
            ? {
                pageSize: MULTI_SELECT_PAGE_SIZE,
                showSizeChanger: false,
                size: 'small',
              }
            : false
        }
        loading={loading}
      />
    </StyledBox>
  );
}
