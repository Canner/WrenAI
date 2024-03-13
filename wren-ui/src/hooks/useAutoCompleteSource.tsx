import { useMemo } from 'react';
import { SQLEditorAutoCompleteSourceWordInfo } from '@/components/editor';

type TableColumn = { name: string; type: string };
type Scope = { name: string; columns: TableColumn[] };

const checkSqlName = (name: string) => {
  return name.match(/^\d+/g) === null ? name : `"${name}"`;
};

export default function useAutoCompleteSource(scopes?: Scope[]) {
  const allTables = [
    {
      name: 'customer',
      columns: [{ name: 'custKey', type: 'UUID' }],
    },
    {
      name: 'order',
      columns: [{ name: 'orderKey', type: 'UUID' }],
    },
  ];

  const tables = scopes ? scopes : allTables;

  const autoCompleteSource: SQLEditorAutoCompleteSourceWordInfo[] =
    useMemo(() => {
      return tables.reduce((result, item) => {
        result.push({
          caption: item.name,
          value: checkSqlName(item.name),
          meta: 'Table',
        });
        item.columns &&
          item.columns.forEach((column) => {
            result.push({
              caption: `${item.name}.${column.name}`,
              value: checkSqlName(column.name),
              meta: `Column(${column.type})`,
            });
          });
        return result;
      }, []);
    }, [tables]);

  return autoCompleteSource;
}
