import { commitKnowledgeAssetDraft } from './useKnowledgeAssetInteractions';

describe('useKnowledgeAssetInteractions helpers', () => {
  it('commits draft and runs side effects when persisted asset exists', async () => {
    const persistedAsset = { id: 'asset-1' };
    const blurActiveElement = jest.fn();
    const resetDetailViewState = jest.fn();

    const result = await commitKnowledgeAssetDraft({
      saveAssetDraftToOverview: async () => persistedAsset,
      blurActiveElement,
      resetDetailViewState,
    });

    expect(result).toBe(persistedAsset);
    expect(blurActiveElement).toHaveBeenCalledTimes(1);
    expect(resetDetailViewState).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no persisted asset is returned', async () => {
    const blurActiveElement = jest.fn();
    const resetDetailViewState = jest.fn();

    const result = await commitKnowledgeAssetDraft({
      saveAssetDraftToOverview: async () => null,
      blurActiveElement,
      resetDetailViewState,
    });

    expect(result).toBeNull();
    expect(blurActiveElement).not.toHaveBeenCalled();
    expect(resetDetailViewState).not.toHaveBeenCalled();
  });
});
