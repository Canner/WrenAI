import {
  createDefaultKnowledgeAssetDraft,
  resetKnowledgeAssetDraftState,
} from './useKnowledgeAssetDraftState';

describe('useKnowledgeAssetDraftState helpers', () => {
  it('creates default draft', () => {
    expect(createDefaultKnowledgeAssetDraft()).toEqual({
      name: '',
      description: '',
      important: true,
    });
  });

  it('resets draft via state setter', () => {
    const setAssetDraft = jest.fn();

    resetKnowledgeAssetDraftState({
      setAssetDraft,
    });

    expect(setAssetDraft).toHaveBeenCalledWith({
      name: '',
      description: '',
      important: true,
    });
  });
});
