import { useEffect } from 'react';
import moment from 'moment';
import { Input, Button, Space, DatePicker, Divider } from 'antd';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import CalendarOutlined from '@ant-design/icons/CalendarOutlined';

export const getColumnSearchProps = (props: {
  dataIndex: string;
  placeholder?: string;
  onFilter?: (value: string, record: any) => boolean;
  filteredValue?: any[];
}) => ({
  filterDropdown: (filters: any) => {
    return <SearchFilter {...filters} {...props} />;
  },
  filterIcon: (filtered: boolean) => (
    <SearchOutlined
      style={{ color: filtered ? 'var(--geekblue-6)' : undefined }}
    />
  ),
  filteredValue: props.filteredValue,
});

export const getColumnDateFilterProps = (props: {
  dataIndex: string;
  onFilter?: (value: any, record: any) => boolean;
  filteredValue?: [string, string] | null;
}) => ({
  filterDropdown: (filters) => {
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
}) => {
  useEffect(() => {
    if (!visible && selectedKeys.length === 0) confirm();
  }, [visible]);
  return (
    <>
      <Space className="p-2">
        <Input
          size="small"
          placeholder={`Search ${placeholder || dataIndex}`}
          value={selectedKeys[0]}
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
          onClick={() => clearFilters()}
          size="small"
          disabled={!filteredValue}
        >
          Reset
        </Button>
        <Button type="primary" onClick={() => confirm()} size="small">
          Search
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
}) => {
  useEffect(() => {
    if (!visible && selectedKeys.length === 0) confirm();
  }, [visible]);
  return (
    <>
      <Space className="p-2">
        <DatePicker.RangePicker
          placeholder={['Start Date', 'End Date']}
          value={[
            selectedKeys[0] ? moment(selectedKeys[0]) : null,
            selectedKeys[1] ? moment(selectedKeys[1]) : null,
          ]}
          onChange={(dates) => {
            const values = dates
              ? [dates[0]?.format('YYYY-MM-DD'), dates[1]?.format('YYYY-MM-DD')]
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
          onClick={() => clearFilters()}
          size="small"
          disabled={!filteredValue}
        >
          Reset
        </Button>
        <Button type="primary" onClick={() => confirm()} size="small">
          OK
        </Button>
      </Space>
    </>
  );
};
