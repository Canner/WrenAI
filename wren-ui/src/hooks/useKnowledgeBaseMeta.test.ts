import { resolveActiveKnowledgeBaseFromList } from './useKnowledgeBaseMeta';

describe('useKnowledgeBaseMeta helpers', () => {
  const kbA = { id: 'kb-a', name: 'A' };
  const kbB = { id: 'kb-b', name: 'B' };

  it('prefers selected knowledge base over route/current fallback', () => {
    expect(
      resolveActiveKnowledgeBaseFromList({
        knowledgeBases: [kbA, kbB],
        selectedKnowledgeBaseId: 'kb-b',
        routeKnowledgeBaseId: 'kb-a',
        currentKnowledgeBaseId: 'kb-a',
        selectorKnowledgeBaseFallback: null,
      }),
    ).toEqual(kbB);
  });

  it('falls back to selector knowledge base when list is empty', () => {
    expect(
      resolveActiveKnowledgeBaseFromList({
        knowledgeBases: [],
        selectedKnowledgeBaseId: null,
        routeKnowledgeBaseId: undefined,
        currentKnowledgeBaseId: undefined,
        selectorKnowledgeBaseFallback: kbA,
      }),
    ).toEqual(kbA);
  });
});
