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
          { ...COLUMN.NAME, dataIndex: 'displayName' },
          COLUMN.RELATION_FROM,
          COLUMN.RELATION_TO,
          COLUMN.RELATION,
          { ...COLUMN.DESCRIPTION, width: 160 },
        ]
      }
      expandable={
        showExpandable
          ? {
              expandedRowRender: (record) => (
                <ExpandableRows
                  data={[
                    {
                      title: '来源字段',
                      value: `${record.fromModelDisplayName}.${record.fromColumnDisplayName}`,
                    },
                    {
                      title: '目标字段',
                      value: `${record.toModelDisplayName}.${record.toColumnDisplayName}`,
                    },
                    { title: '描述', value: record.description || '-' },
                  ]}
                />
              ),
            }
          : undefined
      }
    />
  );
}
