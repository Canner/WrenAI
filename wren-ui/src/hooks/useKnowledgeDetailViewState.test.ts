import {
  createDefaultKnowledgeDetailViewState,
  resetKnowledgeDetailViewState,
} from './useKnowledgeDetailViewState';

describe('useKnowledgeDetailViewState helpers', () => {
  it('creates default detail view state', () => {
    expect(createDefaultKnowledgeDetailViewState()).toEqual({
      detailTab: 'overview',
      detailFieldKeyword: '',
      detailFieldFilter: 'all',
    });
  });

  it('resets detail tab/filter/keyword to defaults', () => {
    const setDetailTab = jest.fn();
    const setDetailFieldKeyword = jest.fn();
    const setDetailFieldFilter = jest.fn();

    resetKnowledgeDetailViewState({
      setDetailTab,
      setDetailFieldKeyword,
      setDetailFieldFilter,
    });

    expect(setDetailTab).toHaveBeenCalledWith('overview');
    expect(setDetailFieldKeyword).toHaveBeenCalledWith('');
    expect(setDetailFieldFilter).toHaveBeenCalledWith('all');
  });
});
