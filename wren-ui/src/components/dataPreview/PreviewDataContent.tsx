import { useMemo } from 'react';
import { Table, TableColumnProps } from 'antd';
import { isString } from 'lodash';

const FONT_SIZE = 16;
const BASIC_COLUMN_WIDTH = 100;

type TableColumn = TableColumnProps<any> & { titleText?: string };

interface Props {
  columns: TableColumn[];
  data: Array<any[]>;
  loading: boolean;
  locale?: { emptyText: React.ReactNode };
}

const getValueByValueType = (value: any) =>
  ['boolean', 'object'].includes(typeof value) ? JSON.stringify(value) : value;

const convertResultData = (data: Array<any>, columns) => {
  return data.map((datum: Array<any>, index: number) => {
    const obj = {};
    // should have a unique "key" prop.
    obj['key'] = index;

    datum.forEach((value, index) => {
      const columnName = columns[index].dataIndex;
      obj[columnName] = getValueByValueType(value);
    });

    return obj;
  });
};

export default function PreviewDataContent(props: Props) {
  const { columns = [], data = [], loading, locale } = props;
  const hasColumns = !!columns.length;

  const dynamicWidth = useMemo(() => {
    return columns.reduce((result, column) => {
      const width = isString(column.titleText || column.title)
        ? (column.titleText || (column.title as string)).length * FONT_SIZE
        : BASIC_COLUMN_WIDTH;
      return result + width;
    }, 0);
  }, [columns]);

  const tableColumns = useMemo(() => {
    return columns.map((column) => ({
      ...column,
      ellipsis: true,
    }));
  }, [columns]);

  const dataSource = useMemo(() => convertResultData(data, columns), [data]);

  // https://posthog.com/docs/session-replay/privacy#other-elements
  return (
    <Table
      className={`ph-no-capture ${hasColumns ? 'ant-table-has-header' : ''}`}
      showHeader={hasColumns}
      dataSource={dataSource}
      columns={tableColumns}
      pagination={false}
      size="small"
      scroll={{ y: 280, x: dynamicWidth }}
      loading={loading}
      locale={locale}
    />
  );
}
