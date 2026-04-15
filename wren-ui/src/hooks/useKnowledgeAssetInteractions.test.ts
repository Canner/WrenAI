import {
  buildKnowledgeAssetOverview,
  commitKnowledgeAssetDraft,
} from './useKnowledgeAssetInteractions';

describe('useKnowledgeAssetInteractions helpers', () => {
  it('builds knowledge asset overview text with field and sql details', () => {
    const text = buildKnowledgeAssetOverview({
      name: '订单分析',
      kind: 'model',
      fieldCount: 2,
      primaryKey: 'order_id',
      sourceTableName: 'orders',
      description: '订单主题分析资产',
      sourceSql: 'SELECT * FROM orders',
      fields: [
        {
          fieldName: 'order_id',
          fieldType: 'BIGINT',
          aiName: '订单ID',
          isPrimaryKey: true,
        },
        {
          fieldName: 'amount',
          fieldType: 'DECIMAL',
          aiName: '订单金额',
        },
      ],
    });

    expect(text).toContain('资产名称：订单分析');
    expect(text).toContain('资产类型：数据表');
    expect(text).toContain('- 订单ID (order_id) · BIGINT · 主键');
    expect(text).toContain('- 订单金额 (amount) · DECIMAL');
    expect(text).toContain('SQL / 语句定义：');
    expect(text).toContain('SELECT * FROM orders');
  });

  it('omits sql section when source sql is empty', () => {
    const text = buildKnowledgeAssetOverview({
      name: '用户洞察',
      kind: 'view',
      fieldCount: 1,
      primaryKey: null,
      sourceTableName: null,
      description: null,
      sourceSql: null,
      fields: [
        {
          fieldName: 'city',
          fieldType: 'TEXT',
          aiName: '城市',
        },
      ],
    });

    expect(text).not.toContain('SQL / 语句定义：');
  });

  it('commits draft and runs side effects when persisted asset exists', () => {
    const persistedAsset = { id: 'asset-1' };
    const blurActiveElement = jest.fn();
    const resetDetailViewState = jest.fn();

    const result = commitKnowledgeAssetDraft({
      saveAssetDraftToOverview: () => persistedAsset,
      blurActiveElement,
      resetDetailViewState,
    });

    expect(result).toBe(persistedAsset);
    expect(blurActiveElement).toHaveBeenCalledTimes(1);
    expect(resetDetailViewState).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no persisted asset is returned', () => {
    const blurActiveElement = jest.fn();
    const resetDetailViewState = jest.fn();

    const result = commitKnowledgeAssetDraft({
      saveAssetDraftToOverview: () => null,
      blurActiveElement,
      resetDetailViewState,
    });

    expect(result).toBeNull();
    expect(blurActiveElement).not.toHaveBeenCalled();
    expect(resetDetailViewState).not.toHaveBeenCalled();
  });
});
