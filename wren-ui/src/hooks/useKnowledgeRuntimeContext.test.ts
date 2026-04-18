import {
  buildRuntimeScopeKeyFromRouteQuery,
  resolveKnowledgeEffectiveRuntimeSelector,
  resolveKnowledgeRuntimeSyncScopeKey,
} from './useKnowledgeRuntimeContext';

describe('useKnowledgeRuntimeContext helpers', () => {
  it('builds route runtime scope key from query values', () => {
    expect(
      buildRuntimeScopeKeyFromRouteQuery({
        workspaceId: 'ws-1',
        knowledgeBaseId: ['kb-1'],
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        runtimeScopeId: undefined,
      }),
    ).toBe('ws-1|kb-1|snap-1|deploy-1|');
  });

  it('resolves effective runtime selector using route values first', () => {
    expect(
      resolveKnowledgeEffectiveRuntimeSelector({
        routeRuntimeSelector: {
          workspaceId: 'ws-route',
          knowledgeBaseId: 'kb-route',
          kbSnapshotId: 'snap-route',
          deployHash: 'deploy-route',
        },
        currentWorkspaceId: 'ws-current',
        currentKnowledgeBaseId: 'kb-current',
        currentKbSnapshotId: 'snap-current',
        currentKbSnapshotDeployHash: 'deploy-current',
      }),
    ).toEqual({
      workspaceId: 'ws-route',
      knowledgeBaseId: 'kb-route',
      kbSnapshotId: 'snap-route',
      deployHash: 'deploy-route',
      runtimeScopeId: undefined,
    });
  });

  it('falls back to current selector state when route values are missing', () => {
    expect(
      resolveKnowledgeEffectiveRuntimeSelector({
        routeRuntimeSelector: {},
        currentWorkspaceId: 'ws-current',
        currentKnowledgeBaseId: 'kb-current',
        currentKbSnapshotId: 'snap-current',
        currentKbSnapshotDeployHash: 'deploy-current',
      }),
    ).toEqual({
      workspaceId: 'ws-current',
      knowledgeBaseId: 'kb-current',
      kbSnapshotId: 'snap-current',
      deployHash: 'deploy-current',
      runtimeScopeId: undefined,
    });
  });

  it('does not reuse a current snapshot when the route points to a different knowledge base', () => {
    expect(
      resolveKnowledgeEffectiveRuntimeSelector({
        routeRuntimeSelector: {
          workspaceId: 'ws-route',
          knowledgeBaseId: 'kb-route',
        },
        currentWorkspaceId: 'ws-current',
        currentKnowledgeBaseId: 'kb-current',
        currentKbSnapshotId: 'snap-current',
        currentKbSnapshotDeployHash: 'deploy-current',
      }),
    ).toEqual({
      workspaceId: 'ws-route',
      knowledgeBaseId: 'kb-route',
      kbSnapshotId: undefined,
      deployHash: undefined,
      runtimeScopeId: undefined,
    });
  });

  it('returns null sync scope key when route not ready or runtime scope disabled', () => {
    expect(
      resolveKnowledgeRuntimeSyncScopeKey({
        routerReady: false,
        hasRuntimeScope: true,
        currentRouteRuntimeScopeKey: 'key',
      }),
    ).toBeNull();

    expect(
      resolveKnowledgeRuntimeSyncScopeKey({
        routerReady: true,
        hasRuntimeScope: false,
        currentRouteRuntimeScopeKey: 'key',
      }),
    ).toBeNull();
  });

  it('returns scope key when route ready and runtime scope enabled', () => {
    expect(
      resolveKnowledgeRuntimeSyncScopeKey({
        routerReady: true,
        hasRuntimeScope: true,
        currentRouteRuntimeScopeKey: 'key',
      }),
    ).toBe('key');
  });
});
