import BaseTable, { Props, COLUMN } from '@/components/table/BaseTable';

export default function RelationTable(props: Props) {
  const { columns } = props;
  return (
    <BaseTable
      {...props}
      columns={
        columns || [
          COLUMN.DISPLAY_NAME,
          COLUMN.REFERENCE_NAME,
          COLUMN.RELATION,
          COLUMN.DESCRIPTION,
        ]
      }
    />
  );
}
