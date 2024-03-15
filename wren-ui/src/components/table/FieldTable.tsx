import BaseTable, { Props, COLUMN } from '@/components/table/BaseTable';

export default function FieldTable(props: Props) {
  const { columns } = props;
  return (
    <BaseTable
      {...props}
      columns={columns || [COLUMN.REFERENCE_NAME, COLUMN.TYPE]}
    />
  );
}
