import { useEffect } from 'react';
import moment from 'moment';
import { Input, Button, Space, DatePicker, Divider } from 'antd';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import CalendarOutlined from '@ant-design/icons/CalendarOutlined';
import { Key } from 'react';

type FilterDropdownRenderProps = {
  setSelectedKeys: (selectedKeys: Key[]) => void;
  selectedKeys: Key[];
  confirm: () => void;
  clearFilters?: () => void;
  visible?: boolean;
};

type SearchColumnProps = {
  dataIndex: string;
  placeholder?: string;
  onFilter?: (value: string, record: any) => boolean;
  filteredValue?: string[];
};

type DateColumnProps = {
  dataIndex: string;
  onFilter?: (value: string, record: any) => boolean;
  filteredValue?: [string, string] | null;
};

export const getColumnSearchProps = (props: SearchColumnProps) => ({
  filterDropdown: (filters: FilterDropdownRenderProps) => {
    return <SearchFilter {...filters} {...props} />;
  },
  filterIcon: (filtered: boolean) => (
    <SearchOutlined
      style={{ color: filtered ? 'var(--geekblue-6)' : undefined }}
    />
  ),
  filteredValue: props.filteredValue,
});

export const getColumnDateFilterProps = (props: DateColumnProps) => ({
  filterDropdown: (filters: FilterDropdownRenderProps) => {
    return <DateFilter {...filters} {...props} />;
  },
  filterIcon: (filtered: boolean) => (
    <CalendarOutlined
      style={{ color: filtered ? 'var(--geekblue-6)' : undefined }}
    />
  ),
  filteredValue: props.filteredValue,
});

const SearchFilter = ({
  setSelectedKeys,
  selectedKeys,
  confirm,
  clearFilters,
  visible,
  dataIndex,
  placeholder,
  filteredValue,
}: FilterDropdownRenderProps & SearchColumnProps) => {
  useEffect(() => {
    if (!visible && selectedKeys.length === 0) confirm();
  }, [confirm, selectedKeys.length, visible]);
  return (
    <>
      <Space className="p-2">
        <Input
          size="small"
          placeholder={`搜索${placeholder || dataIndex}`}
          value={selectedKeys[0] as string | undefined}
          onChange={(e) =>
            setSelectedKeys(e.target.value ? [e.target.value] : [])
          }
          onPressEnter={() => confirm()}
          style={{ width: 188 }}
        />
      </Space>
      <Divider style={{ margin: 0 }} />
      <Space className="d-flex justify-end p-2">
        <Button
          type="link"
          onClick={() => clearFilters?.()}
          size="small"
          disabled={!filteredValue?.length}
        >
          重置
        </Button>
        <Button type="primary" onClick={() => confirm()} size="small">
          搜索
        </Button>
      </Space>
    </>
  );
};

const DateFilter = ({
  filteredValue,
  setSelectedKeys,
  selectedKeys,
  confirm,
  clearFilters,
  visible,
}: FilterDropdownRenderProps & Pick<DateColumnProps, 'filteredValue'>) => {
  useEffect(() => {
    if (!visible && selectedKeys.length === 0) confirm();
  }, [confirm, selectedKeys.length, visible]);
  return (
    <>
      <Space className="p-2">
        <DatePicker.RangePicker
          placeholder={['开始日期', '结束日期']}
          value={[
            selectedKeys[0] ? moment(String(selectedKeys[0])) : null,
            selectedKeys[1] ? moment(String(selectedKeys[1])) : null,
          ]}
          onChange={(dates) => {
            const values = dates
              ? [
                  dates[0]?.format('YYYY-MM-DD'),
                  dates[1]?.format('YYYY-MM-DD'),
                ].filter((value): value is string => Boolean(value))
              : [];
            setSelectedKeys(values);
          }}
          style={{ width: 250 }}
        />
      </Space>
      <Divider style={{ margin: 0 }} />
      <Space className="d-flex justify-end p-2">
        <Button
          type="link"
          onClick={() => clearFilters?.()}
          size="small"
          disabled={!filteredValue?.length}
        >
          重置
        </Button>
        <Button type="primary" onClick={() => confirm()} size="small">
          确定
        </Button>
      </Space>
    </>
  );
};
