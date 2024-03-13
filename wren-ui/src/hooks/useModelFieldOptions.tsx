import { NODE_TYPE } from '@/utils/enum';
import { compactObject } from '@/utils/helper';
import { getNodeTypeIcon } from '@/utils/nodeType';

interface SelectValue {
  nodeType: NODE_TYPE;
  name: string;
  type?: string;
}

export interface ModelFieldResposeData {
  name: string;
  columns: {
    name: string;
    properties: {
      type: string;
    };
  }[];
}

export type ModelFieldOption = {
  label: string | JSX.Element;
  value?: SelectValue;
  options?: ModelFieldOption[];
};

export default function useModelFieldOptions(
  transientData?: ModelFieldResposeData[]
) {
  const response = transientData
    ? transientData
    : [
        {
          name: 'Customer',
          columns: [
            {
              name: 'orders',
              properties: { type: 'Orders' },
            },
            {
              name: 'orderDate',
              properties: { type: 'TIMESTAMP' },
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
          ],
        },
      ];

  const currentModel = response[0];
  const lineage = response.slice(1, response.length);

  if (currentModel === undefined) return [];

  const convertor = (item: any) => {
    const isModel = !!item.columns;
    const nodeType = isModel ? NODE_TYPE.MODEL : NODE_TYPE.FIELD;
    const columnType = item.properties?.type;
    const value: SelectValue = compactObject({
      nodeType,
      name: item.name,
      type: columnType,
    });

    return {
      label: (
        <div className="d-flex align-center">
          {getNodeTypeIcon(
            { nodeType, type: columnType },
            { className: 'mr-1' }
          )}
          {item.name}
        </div>
      ),
      value,
    };
  };

  const columns: ModelFieldOption[] = currentModel.columns.map(convertor) || [];
  const relations: ModelFieldOption[] = lineage.length
    ? [{ label: 'Relations', options: lineage.map(convertor) }]
    : [];

  return [columns, relations].flat();
}
