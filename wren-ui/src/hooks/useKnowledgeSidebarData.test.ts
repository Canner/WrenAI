import {
  buildKnowledgeSidebarItems,
  prioritizeKnowledgeSidebarItems,
} from './useKnowledgeSidebarData';

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

  it('uses assetCount instead of snapshotCount for non-demo knowledge bases', () => {
    expect(
      buildKnowledgeSidebarItems(
        [
          {
            id: 'kb-empty',
            name: '空知识库',
            assetCount: 0,
            snapshotCount: 1,
          },
          {
            id: 'kb-filled',
            name: '有资产知识库',
            assetCount: 3,
            snapshotCount: 1,
          },
        ],
        null,
      ),
    ).toEqual([
      expect.objectContaining({
        id: 'kb-empty',
        assetCount: 0,
      }),
      expect.objectContaining({
        id: 'kb-filled',
        assetCount: 3,
      }),
    ]);
  });
});
