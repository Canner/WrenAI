import {
  clearKnowledgeDetailAsset,
  replaceKnowledgeRouteWithShallow,
} from './useKnowledgeRouteActions';

describe('useKnowledgeRouteActions helpers', () => {
  it('replaces route with shallow mode and disabled scroll', async () => {
    const replace = jest.fn().mockResolvedValue(true);

    await replaceKnowledgeRouteWithShallow({ replace }, '/knowledge?a=1');

    expect(replace).toHaveBeenCalledWith('/knowledge?a=1', undefined, {
      shallow: true,
      scroll: false,
    });
  });

  it('clears detail asset', () => {
    const setDetailAsset = jest.fn();
    clearKnowledgeDetailAsset(setDetailAsset);
    expect(setDetailAsset).toHaveBeenCalledWith(null);
  });
});
