import { commitKnowledgeAssetDraft } from './useKnowledgeAssetInteractions';

describe('useKnowledgeAssetInteractions helpers', () => {
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
