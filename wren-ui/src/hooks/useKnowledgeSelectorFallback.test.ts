import { resolveKnowledgeSelectorFallback } from './useKnowledgeSelectorFallback';

describe('useKnowledgeSelectorFallback helpers', () => {
  it('returns null when both route and selector knowledge base are missing', () => {
    expect(
      resolveKnowledgeSelectorFallback({
        runtimeSelectorState: null,
        routeKnowledgeBaseId: null,
      }),
    ).toBeNull();
  });

  it('builds fallback using route knowledge base id and snapshot ids', () => {
    const result = resolveKnowledgeSelectorFallback({
      runtimeSelectorState: {
        currentWorkspace: { id: 'ws-1', slug: 'ws', name: '工作区' },
        workspaces: [],
        currentKnowledgeBase: { id: 'kb-selector', slug: 'kb', name: 'KB A' },
        currentKbSnapshot: {
          id: 'snap-selector',
          snapshotKey: 'snap',
          displayName: '快照',
          deployHash: 'deploy',
          status: 'READY',
        },
        knowledgeBases: [],
        kbSnapshots: [],
      },
      routeKnowledgeBaseId: 'kb-route',
      effectiveWorkspaceId: 'ws-effective',
      routeKbSnapshotId: 'snap-route',
      currentKbSnapshotId: 'snap-current',
    });

    expect(result).toMatchObject({
      id: 'kb-route',
      workspaceId: 'ws-effective',
      slug: 'kb-route',
      name: 'KB A',
      defaultKbSnapshotId: 'snap-route',
      snapshotCount: 0,
      defaultKbSnapshot: {
        id: 'snap-selector',
        displayName: '快照',
        deployHash: 'deploy',
        status: 'READY',
      },
    });
  });

  it('falls back to selector knowledge base when route knowledge base is missing', () => {
    const result = resolveKnowledgeSelectorFallback({
      runtimeSelectorState: {
        currentWorkspace: { id: 'ws-1', slug: 'ws', name: '工作区' },
        workspaces: [],
        currentKnowledgeBase: { id: 'kb-selector', slug: 'kb', name: 'KB A' },
        currentKbSnapshot: null,
        knowledgeBases: [],
        kbSnapshots: [],
      },
      routeKnowledgeBaseId: null,
      effectiveWorkspaceId: undefined,
      currentWorkspaceId: 'ws-current',
      routeKbSnapshotId: null,
      currentKbSnapshotId: 'snap-current',
    });

    expect(result).toMatchObject({
      id: 'kb-selector',
      workspaceId: 'ws-current',
      slug: 'kb-selector',
      name: 'KB A',
      defaultKbSnapshotId: 'snap-current',
      defaultKbSnapshot: null,
    });
  });
});
