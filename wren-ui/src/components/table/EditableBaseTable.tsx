import React, { useEffect, useState } from 'react';
import { set, cloneDeep, isEmpty } from 'lodash';
import { COLUMN, Props as BaseTableProps } from '@/components/table/BaseTable';
import EditableWrapper from '@/components/EditableWrapper';

type Props = BaseTableProps & {
  onChange?: (value: any) => void;
};

const EditableCell = (props) => {
  const { editable, record, handleSave, dataIndex, children } = props;
  const childNode = editable ? (
    <EditableWrapper
      record={record}
      dataIndex={dataIndex}
      handleSave={handleSave}
    >
      {children}
    </EditableWrapper>
  ) : (
    children
  );
  return <td>{childNode}</td>;
};

export const makeEditableBaseTable = (BaseTable: React.FC<BaseTableProps>) => {
  const EditableBaseTable = (props: Props) => {
    const { columns, dataSource, onChange } = props;
    const [data, setData] = useState(dataSource);
    const components = {
      body: { cell: !isEmpty(dataSource) ? EditableCell : undefined },
    };

    useEffect(() => {
      onChange && onChange(data);
    }, [data]);

    const handleSave = (id: string, value: { [key: string]: string }) => {
      const [dataIndexKey] = Object.keys(value);

      // sync value back to data state
      const newData = cloneDeep(data);
      newData.forEach((item) => {
        if (id === item.id) set(item, dataIndexKey, value[dataIndexKey]);
      });

      setData(newData);
    };

    const tableColumns = columns.map((column) => ({
      ...column,
      onCell: (record) => ({
        editable: [
          COLUMN.DISPLAY_NAME.title,
          COLUMN.DESCRIPTION.title,
        ].includes(column.title as string),
        dataIndex: (column as any).dataIndex,
        record,
        handleSave,
      }),
    })) as Props['columns'];

    return (
      <BaseTable
        {...props}
        size="small"
        dataSource={data}
        columns={tableColumns}
        components={components}
      />
    );
  };

  return EditableBaseTable;
};
