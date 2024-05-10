import BaseTable, {
  Props,
  COLUMN,
  ExpandableRows,
} from '@/components/table/BaseTable';

export default function CalculatedFieldTable(props: Props) {
  const { columns, showExpandable } = props;
  return (
    <BaseTable
      {...props}
      columns={
        columns || [
          { ...COLUMN.NAME, dataIndex: 'displayName', width: 160 },
          COLUMN.EXPRESSION,
          { ...COLUMN.DESCRIPTION, width: 160 },
        ]
      }
      expandable={
        showExpandable
          ? {
              expandedRowRender: (record) => (
                <ExpandableRows
                  data={[
                    { title: 'Description', value: record.description || '-' },
                  ]}
                />
              ),
            }
          : null
      }
    />
  );
}
