import BaseTable, {
  Props,
  COLUMN,
  ExpandableRows,
} from '@/components/table/BaseTable';

export default function RelationTable(props: Props) {
  const { columns, showExpandable } = props;
  return (
    <BaseTable
      {...props}
      columns={
        columns || [
          COLUMN.REFERENCE_NAME,
          COLUMN.RELATION_FROM,
          COLUMN.RELATION_TO,
          COLUMN.RELATION,
          { ...COLUMN.DESCRIPTION, width: 150 },
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
