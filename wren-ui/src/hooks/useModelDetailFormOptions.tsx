import { useMemo } from 'react';
import useAutoCompleteSource from '@/hooks/useAutoCompleteSource';

interface Props {
  selectedTable?: string;
}

export default function useModelDetailFormOptions(props: Props) {
  const { selectedTable } = props;
  const response = [
    {
      name: 'customer',
      columns: [{ name: 'custKey', type: 'UUID' }],
    },
    {
      name: 'order',
      columns: [{ name: 'orderKey', type: 'UUID' }],
    },
  ];

  const dataSourceTableOptions = useMemo(() => {
    return response.map((item) => ({
      label: item.name,
      value: item.name,
    }));
  }, [response]);

  const dataSourceTableColumnOptions = useMemo(() => {
    const table = response.find((table) => table.name === selectedTable);
    return (table?.columns || []).map((column) => ({
      label: column.name,
      value: { name: column.name, type: column.type },
    }));
  }, [selectedTable]);

  const autoCompleteSource = useAutoCompleteSource(response);

  return {
    dataSourceTableOptions,
    dataSourceTableColumnOptions,
    autoCompleteSource,
  };
}
