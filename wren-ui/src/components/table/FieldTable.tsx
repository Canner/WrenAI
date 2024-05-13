import BaseTable, {
  Props,
  COLUMN,
  ExpandableRows,
} from '@/components/table/BaseTable';

export default function FieldTable(props: Props) {
  const { columns, showExpandable } = props;
  return (
    <BaseTable
      {...props}
      columns={
        columns || [COLUMN.NAME, COLUMN.ALIAS, COLUMN.TYPE, COLUMN.DESCRIPTION]
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
