import { prioritizeKnowledgeSidebarItems } from './useKnowledgeSidebarData';

describe('useKnowledgeSidebarData helpers', () => {
  it('prioritizes current knowledge base and keeps at most 4 items', () => {
    const items = [
      { id: 'kb-c', name: 'C' },
      { id: 'kb-a', name: 'A' },
      { id: 'kb-b', name: 'B' },
      { id: 'kb-d', name: 'D' },
      { id: 'kb-e', name: 'E' },
    ];

    expect(prioritizeKnowledgeSidebarItems(items, 'kb-d')).toEqual([
      { id: 'kb-d', name: 'D' },
      { id: 'kb-a', name: 'A' },
      { id: 'kb-b', name: 'B' },
      { id: 'kb-c', name: 'C' },
    ]);
  });
});
