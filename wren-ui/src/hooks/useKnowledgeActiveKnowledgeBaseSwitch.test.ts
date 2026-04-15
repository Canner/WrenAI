import { shouldResetKnowledgeStateOnBaseSwitch } from './useKnowledgeActiveKnowledgeBaseSwitch';

describe('useKnowledgeActiveKnowledgeBaseSwitch helpers', () => {
  it('returns true only when previous and current kb ids are different', () => {
    expect(
      shouldResetKnowledgeStateOnBaseSwitch({
        previousKnowledgeBaseId: 'kb-1',
        activeKnowledgeBaseId: 'kb-2',
      }),
    ).toBe(true);

    expect(
      shouldResetKnowledgeStateOnBaseSwitch({
        previousKnowledgeBaseId: 'kb-1',
        activeKnowledgeBaseId: 'kb-1',
      }),
    ).toBe(false);

    expect(
      shouldResetKnowledgeStateOnBaseSwitch({
        previousKnowledgeBaseId: null,
        activeKnowledgeBaseId: 'kb-2',
      }),
    ).toBe(false);
  });
});
