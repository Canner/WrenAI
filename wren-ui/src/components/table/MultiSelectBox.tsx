import { useState, useMemo, useContext } from 'react';
import styled from 'styled-components';
import { isString } from 'lodash';
import { Input, Table } from 'antd';
import { ColumnsType } from 'antd/lib/table';
import { SearchOutlined } from '@ant-design/icons';
import {
  FormItemInputContext,
  FormItemStatusContextProps,
} from 'antd/lib/form/context';

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

interface Props {
  columns: ColumnsType<any>;
  items: { [key: string]: any; value: string }[];
  value?: string[];
  onChange?: (value: string[]) => void;
}

export default function MultiSelectBox(props: Props) {
  const { columns, items, onChange, value } = props;
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>(
    value || []
  );
  const [searchValue, setSearchValue] = useState<string>('');
  const formItemContext =
    useContext<FormItemStatusContextProps>(FormItemInputContext);
  const { status } = formItemContext;

  const dataSource = useMemo(() => {
    return searchValue
      ? items.filter((item) =>
          columns
            .map((column) => item[column['dataIndex']])
            .some((value) => isString(value) && value.includes(searchValue))
        )
      : items;
  }, [items, searchValue]);

  const onSelect = (rowKeys: React.Key[]) => {
    setSelectedRowKeys(rowKeys);
    onChange && onChange(rowKeys as string[]);
  };

  const onSearchChange = (event) => {
    event.persist();
    const { value } = event.target;
    setSearchValue(value);
  };

  const total =
    selectedRowKeys.length === 0
      ? items.length
      : `${selectedRowKeys.length}/${items.length}`;

  return (
    <StyledBox
      className={status ? `multiSelectBox-input-${status}` : undefined}
    >
      <StyledTotal>{total} table(s)</StyledTotal>
      <div className="p-2">
        <Input
          prefix={<SearchOutlined />}
          onChange={onSearchChange}
          placeholder="Search here"
          allowClear
        />
      </div>
      <Table
        rowSelection={{
          type: 'checkbox',
          selectedRowKeys,
          onChange: onSelect,
        }}
        rowKey={(record) => record.value}
        columns={columns}
        dataSource={dataSource}
        scroll={{ y: 195 }}
        pagination={false}
      />
    </StyledBox>
  );
}
