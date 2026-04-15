import {
  filterKnowledgeDetailFields,
  resolveActiveKnowledgeDetailAsset,
} from './useKnowledgeAssetDetail';

describe('useKnowledgeAssetDetail helpers', () => {
  const assetA = {
    id: 'asset-a',
    fields: [
      {
        fieldName: 'order_id',
        aiName: '订单ID',
        fieldType: 'INTEGER',
        note: '主键',
        isPrimaryKey: true,
        isCalculated: false,
      },
      {
        fieldName: 'gmv',
        aiName: '成交额',
        fieldType: 'NUMBER',
        note: '',
        isPrimaryKey: false,
        isCalculated: true,
      },
    ],
  };
  const assetB = {
    id: 'asset-b',
    fields: [],
  };

  it('prefers live list asset when ids match', () => {
    expect(resolveActiveKnowledgeDetailAsset([assetA, assetB], assetA)).toBe(
      assetA,
    );
  });

  it('filters fields by filter and keyword', () => {
    expect(
      filterKnowledgeDetailFields({
        fields: assetA.fields,
        keyword: '',
        filter: 'primary',
      }),
    ).toHaveLength(1);

    expect(
      filterKnowledgeDetailFields({
        fields: assetA.fields,
        keyword: '成交',
        filter: 'all',
      }),
    ).toHaveLength(1);

    expect(
      filterKnowledgeDetailFields({
        fields: assetA.fields,
        keyword: '',
        filter: 'calculated',
      }),
    ).toHaveLength(1);
  });
});
