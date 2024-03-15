import BaseTable, { Props, COLUMN } from '@/components/table/BaseTable';

export default function RelationTable(props: Props) {
  const { columns } = props;
  return (
    <BaseTable
      {...props}
      columns={
        columns || [
          COLUMN.REFERENCE_NAME,
          COLUMN.RELATION_FROM,
          COLUMN.RELATION_TO,
          COLUMN.RELATION,
          COLUMN.DESCRIPTION,
        ]
      }
    />
  );
}
