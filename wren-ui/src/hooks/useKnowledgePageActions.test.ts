import {
  buildKnowledgeSwitchPath,
  resolveKnowledgeRuntimeSelector,
} from './useKnowledgePageActions';

describe('useKnowledgePageActions helpers', () => {
  it('builds switch path with workspace and snapshot params', () => {
    expect(
      buildKnowledgeSwitchPath({
        id: 'kb-1',
        workspaceId: 'ws-1',
        defaultKbSnapshot: {
          id: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe(
      '/knowledge?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });

  it('falls back to runtime selector when no knowledge base is provided', () => {
    expect(
      resolveKnowledgeRuntimeSelector({
        knowledgeBase: null,
        fallbackSelector: { workspaceId: 'ws-1' },
      }),
    ).toEqual({ workspaceId: 'ws-1' });
  });
});
