import { useEffect } from 'react';
import { Input, Button, Space, Divider } from 'antd';
import SearchOutlined from '@ant-design/icons/SearchOutlined';

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
