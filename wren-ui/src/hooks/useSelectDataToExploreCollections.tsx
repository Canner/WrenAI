import { NODE_TYPE } from '@/utils/enum';

export default function useSelectDataToExploreCollections() {
  // TODO: Replace with real data
  const models = [
    {
      id: '1',
      name: 'Customer',
      nodeType: NODE_TYPE.MODEL,
      description: 'customer_description',
      table: 'customer',
      fields: [
        {
          name: 'custKey',
          type: 'UUID',
        },
      ],
      calculatedFields: [
        {
          name: 'test',
          expression: 'Sum',
          modelFields: [
            { nodeType: NODE_TYPE.MODEL, name: 'customer' },
            { nodeType: NODE_TYPE.FIELD, name: 'custKey', type: 'UUID' },
          ],
        },
      ],
    },
    {
      id: '2',
      name: 'Customer2',
      nodeType: NODE_TYPE.MODEL,
      description: 'customer_description',
      table: 'customer',
      fields: [
        {
          name: 'custKey',
          type: 'UUID',
        },
      ],
      calculatedFields: [
        {
          name: 'test',
          expression: 'Sum',
          modelFields: [
            { nodeType: NODE_TYPE.MODEL, name: 'customer' },
            { nodeType: NODE_TYPE.FIELD, name: 'custKey', type: 'UUID' },
          ],
        },
      ],
    },
    {
      id: '3',
      name: 'Customer3',
      nodeType: NODE_TYPE.MODEL,
      description: 'customer_description',
      table: 'customer',
      fields: [
        {
          name: 'custKey',
          type: 'UUID',
        },
      ],
      calculatedFields: [
        {
          name: 'test',
          expression: 'Sum',
          modelFields: [
            { nodeType: NODE_TYPE.MODEL, name: 'customer' },
            { nodeType: NODE_TYPE.FIELD, name: 'custKey', type: 'UUID' },
          ],
        },
      ],
    },
  ];

  const metrics = [
    { id: 'o1', name: 'Test1', nodeType: NODE_TYPE.METRIC },
    { id: 'o2', name: 'Test2', nodeType: NODE_TYPE.METRIC },
    { id: 'o3', name: 'Test3', nodeType: NODE_TYPE.METRIC },
    { id: 'o4', name: 'Test4', nodeType: NODE_TYPE.METRIC },
    { id: 'o5', name: 'Test5', nodeType: NODE_TYPE.METRIC },
    { id: 'o6', name: 'Test6', nodeType: NODE_TYPE.METRIC },
  ];

  const views = [
    { id: 'c1', name: 'Test1', nodeType: NODE_TYPE.VIEW },
    { id: 'c2', name: 'Test2', nodeType: NODE_TYPE.VIEW },
    { id: 'c3', name: 'Test3', nodeType: NODE_TYPE.VIEW },
    { id: 'c4', name: 'Test4', nodeType: NODE_TYPE.VIEW },
    { id: 'c5', name: 'Test5', nodeType: NODE_TYPE.VIEW },
    { id: 'c6', name: 'Test6', nodeType: NODE_TYPE.VIEW },
  ];

  return {
    models,
    metrics,
    views,
  };
}
