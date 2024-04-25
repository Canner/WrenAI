import BaseTable, {
  Props,
  COLUMN,
  ExpandableRows,
} from '@/components/table/BaseTable';

export default function FieldTable(props: Props) {
  const { columns } = props;
  return (
    <BaseTable
      {...props}
      columns={
        columns || [
          COLUMN.REFERENCE_NAME,
          COLUMN.ALIAS,
          COLUMN.TYPE,
          COLUMN.DESCRIPTION,
        ]
      }
      expandable={{
        expandedRowRender: (record) => (
          <ExpandableRows
            data={[{ title: 'Description', value: record.description || '-' }]}
          />
        ),
      }}
    />
  );
}
