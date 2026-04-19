import {
  buildKnowledgeWorkbenchContextAssetOptions,
  resolveKnowledgeWorkbenchContextAsset,
} from './knowledgeWorkbenchContextAssetUtils';

describe('knowledgeWorkbenchContextAssetUtils', () => {
  const detailAssets = [
    {
      id: 'asset-1',
      name: 'orders',
      kind: 'model',
      fieldCount: 2,
      fields: [],
    },
    {
      id: 'asset-2',
      name: 'customers',
      kind: 'view',
      fieldCount: 1,
      fields: [],
    },
  ];

  it('resolves a selected context asset by id', () => {
    expect(
      resolveKnowledgeWorkbenchContextAsset(detailAssets as any, 'asset-2'),
    ).toEqual(
      expect.objectContaining({
        id: 'asset-2',
        name: 'customers',
      }),
    );
  });

  it('returns null for an unknown context asset id', () => {
    expect(
      resolveKnowledgeWorkbenchContextAsset(detailAssets as any, 'missing'),
    ).toBeNull();
  });

  it('builds asset options for the SQL template selector', () => {
    expect(
      buildKnowledgeWorkbenchContextAssetOptions(detailAssets as any),
    ).toEqual([
      { label: 'orders', value: 'asset-1' },
      { label: 'customers', value: 'asset-2' },
    ]);
  });
});
