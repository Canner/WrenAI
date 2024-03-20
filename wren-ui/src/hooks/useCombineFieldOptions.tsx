import { useMemo, useState } from 'react';

interface Props {
  // The initial base model of model select
  model?: string;
  // The models to be excluded from model select
  excludeModels?: string[];
}

export default function useCombineFieldOptions(props: Props) {
  const { model, excludeModels } = props;
  const [baseModel, setBaseModel] = useState<string>(model || '');

  const response = [
    {
      name: 'Customer',
      columns: [
        {
          name: 'orders',
          properties: { type: 'Orders' },
        },
        {
          name: 'custkey',
        },
        {
          name: 'id',
        },
      ],
    },
    {
      name: 'Orders',
      columns: [
        {
          name: 'lineitem',
          properties: { type: 'Lineitem' },
        },
        {
          name: 'orderkey',
        },
      ],
    },
    {
      name: 'Lineitem',
      columns: [
        {
          name: 'extendedprice',
          properties: { type: 'REAL' },
        },
        {
          name: 'discount',
          properties: { type: 'REAL' },
        },
        {
          name: 'orderkey',
        },
      ],
    },
    {
      name: 'trans',
      columns: [
        {
          name: 'custkey',
        },
        {
          name: 'col_a',
        },
        {
          name: 'col_b',
        },
      ],
    },
  ].filter((item) => !(excludeModels && excludeModels.includes(item.name)));

  const modelOptions = useMemo(() => {
    return response.map((item) => ({
      label: item.name,
      value: item.name,
    }));
  }, [response]);

  const fieldOptions = useMemo(() => {
    const model = response.find((item) => item.name === baseModel);
    return (model?.columns || []).map((column) => ({
      label: column.name,
      value: column.name,
    }));
  }, [baseModel]);

  return { modelOptions, fieldOptions, onModelChange: setBaseModel };
}
