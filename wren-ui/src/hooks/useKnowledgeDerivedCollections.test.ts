import { resolveDetailAssets } from './useKnowledgeDerivedCollections';

describe('useKnowledgeDerivedCollections helpers', () => {
  it('prefers runtime assets when asset list is not empty', () => {
    expect(
      resolveDetailAssets({
        assets: [{ id: 'a1' }],
        overviewPreviewAsset: { id: 'preview' },
      }),
    ).toEqual([{ id: 'a1' }]);
  });

  it('falls back to overview preview asset when runtime assets are empty', () => {
    expect(
      resolveDetailAssets({
        assets: [],
        overviewPreviewAsset: { id: 'preview' },
      }),
    ).toEqual([{ id: 'preview' }]);
  });

  it('returns empty list when both runtime and preview assets are empty', () => {
    expect(
      resolveDetailAssets({
        assets: [],
        overviewPreviewAsset: null,
      }),
    ).toEqual([]);
  });
});
